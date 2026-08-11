//! Consumer contracts for the reusable graph engine (#227).

use jeff_graph::{
    hit_test, CacheDecision, CellPoint, Degradation, EdgeKind, GraphCanvas, GraphModel,
    LayoutCache, NodeGeometry, SelectionDirection, Viewport, WorldRect,
};
use jeff_project::{ProjectMode, Snapshot, SnapshotTask, TaskId};
use ratatui::{buffer::Buffer, layout::Rect, style::Color, widgets::Widget};

fn id(value: u64) -> TaskId {
    TaskId::Number(value)
}

fn string_id(value: &str) -> TaskId {
    TaskId::String(value.into())
}

fn task(value: u64, deps: &[u64], discovered_from: Option<u64>) -> SnapshotTask {
    task_with_id(
        id(value),
        deps.iter().copied().map(id).collect(),
        discovered_from.map(id),
    )
}

fn task_with_id(value: TaskId, deps: Vec<TaskId>, discovered_from: Option<TaskId>) -> SnapshotTask {
    let label = format!("{value:?}");
    SnapshotTask {
        id: value,
        slug: format!("task-{label}"),
        title: format!("Task {label}"),
        status: "pending".into(),
        stage: "implement".into(),
        priority: "p1".into(),
        deps,
        blocked_reason: None,
        category: Some("code".into()),
        discovered_from,
        claim: None,
        escalation: None,
    }
}

fn snapshot(tasks: Vec<SnapshotTask>) -> Snapshot {
    Snapshot {
        schema_version: 1,
        generated_at: "2026-08-10T00:00:00.000Z".into(),
        mode: ProjectMode::Lite,
        max_parallel_tasks: Some(1),
        tasks,
    }
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

fn assert_bounded_intersection(viewport: &Viewport, bounds: WorldRect) {
    let visible = viewport.visible_world();
    let overlap_width =
        (visible.max_x.min(bounds.max_x) - visible.min_x.max(bounds.min_x)).max(0.0);
    let overlap_height =
        (visible.max_y.min(bounds.max_y) - visible.min_y.max(bounds.min_y)).max(0.0);
    let required_width = (visible.width() * 0.2).min(bounds.width());
    let required_height = (visible.height() * 0.2).min(bounds.height());

    assert!(
        overlap_width + 1e-9 >= required_width,
        "horizontal overlap {overlap_width} is below required {required_width}"
    );
    assert!(
        overlap_height + 1e-9 >= required_height,
        "vertical overlap {overlap_height} is below required {required_height}"
    );
}

#[test]
fn dependencies_flow_from_prerequisite_to_dependent_and_missing_ids_degrade() {
    let graph =
        GraphModel::from_snapshot(&snapshot(vec![task(1, &[], None), task(2, &[1, 99], None)]));

    assert_eq!(graph.task_ids(), &[id(1), id(2)]);
    assert!(graph.edges().iter().any(|edge| {
        edge.from == id(1) && edge.to == id(2) && edge.kind == EdgeKind::Dependency
    }));
    assert!(!graph.edges().iter().any(|edge| edge.from == id(99)));
    assert_eq!(
        graph.degradations(),
        &[Degradation::MissingDependency {
            dependent: id(2),
            dependency: id(99),
        }]
    );
}

#[test]
fn discovery_edges_are_distinct_and_cycle_forming_edges_are_dropped() {
    let graph = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], Some(2)),
        task(2, &[1], None),
        task(3, &[], Some(1)),
    ]));

    assert!(graph.edges().iter().any(|edge| {
        edge.from == id(1) && edge.to == id(3) && edge.kind == EdgeKind::Discovery
    }));
    assert!(!graph.edges().iter().any(|edge| {
        edge.from == id(2) && edge.to == id(1) && edge.kind == EdgeKind::Discovery
    }));
    assert!(graph
        .degradations()
        .contains(&Degradation::CyclicDiscovery {
            from: id(2),
            to: id(1),
        }));
}

#[test]
fn equivalent_topologies_have_equal_fingerprints_and_positions() {
    let first = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[1], None),
        task(3, &[1, 2], None),
    ]));
    let second = GraphModel::from_snapshot(&snapshot(vec![
        task(3, &[2, 1], None),
        task(1, &[], None),
        task(2, &[1], None),
    ]));
    let mut first_cache = LayoutCache::default();
    let mut second_cache = LayoutCache::default();

    assert_eq!(first.topology_fingerprint(), second.topology_fingerprint());
    assert_eq!(first_cache.update(&first), CacheDecision::Recomputed);
    assert_eq!(second_cache.update(&second), CacheDecision::Recomputed);
    assert_eq!(
        first_cache.layout().expect("first layout").nodes(),
        second_cache.layout().expect("second layout").nodes()
    );
    let dependency = first_cache
        .layout()
        .expect("first layout")
        .node(&id(1))
        .expect("dependency position");
    let dependent = first_cache
        .layout()
        .expect("first layout")
        .node(&id(2))
        .expect("dependent position");
    assert!(
        dependency.center.y > dependent.center.y,
        "top-to-bottom layout must put prerequisites above dependents"
    );
}

#[test]
fn dependency_cycles_degrade_and_use_stable_node_preserving_fallback() {
    let first = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[2], None),
        task(2, &[1], None),
        task(3, &[1], None),
    ]));
    let second = GraphModel::from_snapshot(&snapshot(vec![
        task(3, &[1], None),
        task(2, &[1], None),
        task(1, &[2], None),
    ]));
    let mut first_cache = LayoutCache::default();
    let mut second_cache = LayoutCache::default();

    assert_eq!(first.degradations(), &[Degradation::CyclicDependencies]);
    assert_eq!(second.degradations(), &[Degradation::CyclicDependencies]);
    assert_eq!(first_cache.update(&first), CacheDecision::Recomputed);
    assert_eq!(second_cache.update(&second), CacheDecision::Recomputed);
    let first_layout = first_cache.layout().expect("first fallback layout");
    let second_layout = second_cache.layout().expect("second fallback layout");
    assert_eq!(
        first_layout
            .nodes()
            .iter()
            .map(|node| node.id.clone())
            .collect::<Vec<_>>(),
        vec![id(1), id(2), id(3)]
    );
    assert_eq!(first_layout.nodes(), second_layout.nodes());
}

#[test]
fn display_only_updates_reuse_layout_but_topology_updates_recompute() {
    let base = snapshot(vec![task(1, &[], None), task(2, &[1], None)]);
    let first = GraphModel::from_snapshot(&base);
    let mut display_changed = base.clone();
    display_changed.generated_at = "2026-08-10T01:00:00.000Z".into();
    display_changed.tasks[0].status = "done".into();
    display_changed.tasks[0].title = "Renamed".into();
    let display_changed = GraphModel::from_snapshot(&display_changed);
    let topology_changed = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[1], None),
        task(3, &[2], None),
    ]));
    let mut cache = LayoutCache::default();

    assert_eq!(cache.update(&first), CacheDecision::Recomputed);
    let original_positions = cache.layout().expect("initial layout").nodes().to_vec();
    assert_eq!(cache.update(&display_changed), CacheDecision::Reused);
    assert_eq!(
        cache.layout().expect("reused layout").nodes(),
        original_positions
    );
    assert_eq!(cache.update(&topology_changed), CacheDecision::Recomputed);
}

#[test]
fn edge_only_topology_changes_recompute_layout_with_stable_ids() {
    let dependency_before = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[1], None),
        task(3, &[], None),
    ]));
    let dependency_after = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[3], None),
        task(3, &[], None),
    ]));
    let discovery_before = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[], None),
        task(3, &[], Some(1)),
    ]));
    let discovery_after = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[], None),
        task(3, &[], Some(2)),
    ]));
    let mut dependency_cache = LayoutCache::default();
    let mut discovery_cache = LayoutCache::default();

    assert_eq!(dependency_before.task_ids(), dependency_after.task_ids());
    assert_ne!(
        dependency_before.topology_fingerprint(),
        dependency_after.topology_fingerprint()
    );
    assert_eq!(
        dependency_cache.update(&dependency_before),
        CacheDecision::Recomputed
    );
    assert_eq!(
        dependency_cache.update(&dependency_after),
        CacheDecision::Recomputed
    );

    assert_eq!(discovery_before.task_ids(), discovery_after.task_ids());
    assert_ne!(
        discovery_before.topology_fingerprint(),
        discovery_after.topology_fingerprint()
    );
    assert_eq!(
        discovery_cache.update(&discovery_before),
        CacheDecision::Recomputed
    );
    assert_eq!(
        discovery_cache.update(&discovery_after),
        CacheDecision::Recomputed
    );
}

#[test]
fn zoom_is_clamped_and_keeps_the_cursor_world_point_anchored() {
    let bounds = WorldRect::new(0.0, 0.0, 1_000.0, 1_000.0);
    let mut viewport = Viewport::new(bounds, 80, 24);
    let cursor = CellPoint::new(20, 8);
    let before = viewport.cell_to_world(cursor);

    viewport.set_zoom_at(2.0, cursor);
    let after = viewport.cell_to_world(cursor);
    assert_close(after.x, before.x);
    assert_close(after.y, before.y);

    viewport.set_zoom_at(100.0, cursor);
    assert_eq!(viewport.zoom(), 8.0);
    viewport.set_zoom_at(0.01, cursor);
    assert_eq!(viewport.zoom(), 0.25);
}

#[test]
fn zoom_out_reclamps_edge_pan_to_bounded_world_intersection() {
    let bounds = WorldRect::new(0.0, 0.0, 1_000.0, 1_000.0);
    let mut viewport = Viewport::new(bounds, 80, 24);
    let cursor = CellPoint::new(0, 0);
    viewport.set_zoom_at(2.0, cursor);
    viewport.pan_by_cells(1_000_000.0, 1_000_000.0);

    viewport.set_zoom_at(0.25, cursor);

    assert_bounded_intersection(&viewport, bounds);
}

#[test]
fn pan_uses_inverse_zoom_and_clamps_to_a_bounded_world_intersection() {
    let bounds = WorldRect::new(0.0, 0.0, 1_000.0, 1_000.0);
    let mut viewport = Viewport::new(bounds, 80, 24);
    let cursor = CellPoint::new(40, 12);
    viewport.set_zoom_at(2.0, cursor);
    let before = viewport.pan();

    viewport.pan_by_cells(10.0, 6.0);
    let after = viewport.pan();
    assert_close(after.x, before.x + 5.0);
    assert_close(after.y, before.y - 3.0);

    viewport.pan_by_cells(1_000_000.0, 1_000_000.0);
    assert_bounded_intersection(&viewport, bounds);
}

#[test]
fn resize_updates_view_bounds_without_invalidating_layout() {
    let graph = GraphModel::from_snapshot(&snapshot(vec![task(1, &[], None), task(2, &[1], None)]));
    let mut cache = LayoutCache::default();
    assert_eq!(cache.update(&graph), CacheDecision::Recomputed);
    let positions = cache.layout().expect("layout").nodes().to_vec();
    let mut viewport = Viewport::new(WorldRect::new(0.0, 0.0, 1_000.0, 1_000.0), 40, 20);
    let old_zoom = viewport.zoom();
    let old_width = viewport.visible_world().width();

    viewport.resize(80, 30);

    assert_eq!(viewport.canvas_size(), (80, 30));
    assert_eq!(viewport.zoom(), old_zoom);
    assert!(viewport.visible_world().width() > old_width);
    assert_eq!(cache.update(&graph), CacheDecision::Reused);
    assert_eq!(cache.layout().expect("reused layout").nodes(), positions);
}

#[test]
fn resize_larger_reclamps_edge_pan_to_bounded_world_intersection() {
    let bounds = WorldRect::new(0.0, 0.0, 1_000.0, 1_000.0);
    let mut viewport = Viewport::new(bounds, 40, 20);
    viewport.pan_by_cells(1_000_000.0, 1_000_000.0);

    viewport.resize(80, 40);

    assert_bounded_intersection(&viewport, bounds);
}

#[test]
fn hit_testing_uses_the_inverse_transform_and_resolves_overlap_deterministically() {
    let viewport = Viewport::new(WorldRect::new(-100.0, -100.0, 100.0, 100.0), 40, 20);
    let cell = CellPoint::new(10, 10);
    let center = viewport.cell_to_world(cell);
    let equal_area = vec![
        NodeGeometry::new(id(1), center, 8.0, 8.0),
        NodeGeometry::new(id(2), center, 8.0, 8.0),
    ];

    assert_eq!(hit_test(&viewport, cell, &equal_area), Some(id(2)));

    let mut with_smaller = equal_area;
    with_smaller.push(NodeGeometry::new(id(1), center, 4.0, 4.0));
    assert_eq!(hit_test(&viewport, cell, &with_smaller), Some(id(1)));
}

#[test]
fn keyboard_navigation_can_reach_the_same_task_as_mouse_hit_testing() {
    let graph = GraphModel::from_snapshot(&snapshot(vec![
        task(3, &[], None),
        task(1, &[], None),
        task(2, &[], None),
    ]));
    let viewport = Viewport::new(WorldRect::new(-100.0, -100.0, 100.0, 100.0), 40, 20);
    let cell = CellPoint::new(10, 10);
    let nodes = vec![NodeGeometry::new(
        id(2),
        viewport.cell_to_world(cell),
        8.0,
        8.0,
    )];
    let mouse_selected = hit_test(&viewport, cell, &nodes).expect("mouse selection");

    assert_eq!(
        graph.navigate(Some(&id(1)), SelectionDirection::Forward),
        Some(&mouse_selected)
    );
    assert_eq!(
        graph.navigate(Some(&id(3)), SelectionDirection::Backward),
        Some(&mouse_selected)
    );
}

#[test]
fn mixed_ids_remain_distinct_and_follow_canonical_layout_selection_order() {
    let number_one = id(1);
    let string_one = string_id("1");
    let alpha = string_id("alpha");
    let zed = string_id("z");
    let graph = GraphModel::from_snapshot(&snapshot(vec![
        task_with_id(zed.clone(), Vec::new(), None),
        task_with_id(string_one.clone(), Vec::new(), None),
        task_with_id(number_one.clone(), Vec::new(), None),
        task_with_id(alpha.clone(), Vec::new(), None),
    ]));
    let without_string_one = GraphModel::from_snapshot(&snapshot(vec![
        task_with_id(zed.clone(), Vec::new(), None),
        task_with_id(number_one.clone(), Vec::new(), None),
        task_with_id(alpha.clone(), Vec::new(), None),
    ]));
    let expected = vec![
        number_one.clone(),
        string_one.clone(),
        alpha.clone(),
        zed.clone(),
    ];

    assert_eq!(graph.task_ids(), expected);
    assert_ne!(
        graph.topology_fingerprint(),
        without_string_one.topology_fingerprint()
    );
    assert_eq!(
        graph.navigate(Some(&number_one), SelectionDirection::Forward),
        Some(&string_one)
    );
    assert_eq!(
        graph.navigate(Some(&number_one), SelectionDirection::Backward),
        Some(&zed)
    );

    let mut cache = LayoutCache::default();
    assert_eq!(cache.update(&graph), CacheDecision::Recomputed);
    assert_eq!(
        cache
            .layout()
            .expect("mixed-id layout")
            .nodes()
            .iter()
            .map(|node| node.id.clone())
            .collect::<Vec<_>>(),
        expected
    );

    let viewport = Viewport::new(WorldRect::new(-100.0, -100.0, 100.0, 100.0), 40, 20);
    let cell = CellPoint::new(10, 10);
    let center = viewport.cell_to_world(cell);
    let equal_nodes = vec![
        NodeGeometry::new(zed.clone(), center, 8.0, 8.0),
        NodeGeometry::new(number_one, center, 8.0, 8.0),
        NodeGeometry::new(alpha, center, 8.0, 8.0),
        NodeGeometry::new(string_one, center, 8.0, 8.0),
    ];
    assert_eq!(hit_test(&viewport, cell, &equal_nodes), Some(zed));
}

#[test]
fn canvas_renders_edges_then_nodes_then_selection_as_terminal_output() {
    let graph = GraphModel::from_snapshot(&snapshot(vec![
        task(1, &[], None),
        task(2, &[1], None),
        task(3, &[], Some(1)),
    ]));
    let mut cache = LayoutCache::default();
    assert_eq!(cache.update(&graph), CacheDecision::Recomputed);
    let layout = cache.layout().expect("layout");
    let viewport = Viewport::new(layout.bounds(), 80, 24);
    let area = Rect::new(0, 0, 80, 24);
    let mut buffer = Buffer::empty(area);

    GraphCanvas::new(&graph, layout, &viewport)
        .selected(Some(&id(2)))
        .render(area, &mut buffer);

    let source = layout.node(&id(1)).expect("source node");
    let selected = layout.node(&id(2)).expect("selected node");
    let source_cell = viewport
        .world_to_cell(source.center)
        .expect("source visible");
    let selected_cell = viewport
        .world_to_cell(selected.center)
        .expect("selection visible");
    assert_eq!(buffer[(source_cell.x, source_cell.y)].fg, Color::White);
    assert_eq!(buffer[(selected_cell.x, selected_cell.y)].fg, Color::Yellow);
    assert!(buffer
        .content()
        .iter()
        .any(|cell| cell.fg == Color::DarkGray));
    assert!(buffer.content().iter().any(|cell| cell.fg == Color::Cyan));
}
