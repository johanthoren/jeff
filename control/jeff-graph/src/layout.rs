use crate::{
    topology::{CanonicalTaskId, GraphModel},
    WorldPoint, WorldRect,
};
use jeff_project::TaskId;
use layout::{
    core::{
        base::Orientation,
        format::{ClipHandle, RenderBackend},
        geometry::{Point, Position},
        style::StyleAttr,
    },
    std_shapes::shapes::{Arrow, Element, ShapeKind},
    topo::layout::VisualGraph,
};
use std::collections::BTreeMap;

const NODE_WIDTH: f64 = 6.0;
const NODE_HEIGHT: f64 = 3.0;
const BOUNDS_PADDING: f64 = 2.0;

#[derive(Clone, Debug, PartialEq)]
pub struct NodeGeometry {
    pub id: TaskId,
    pub center: WorldPoint,
    pub width: f64,
    pub height: f64,
}

impl NodeGeometry {
    pub const fn new(id: TaskId, center: WorldPoint, width: f64, height: f64) -> Self {
        Self {
            id,
            center,
            width,
            height,
        }
    }

    pub fn area(&self) -> f64 {
        self.width * self.height
    }

    pub fn contains(&self, point: WorldPoint) -> bool {
        let half_width = self.width / 2.0;
        let half_height = self.height / 2.0;
        point.x >= self.center.x - half_width
            && point.x <= self.center.x + half_width
            && point.y >= self.center.y - half_height
            && point.y <= self.center.y + half_height
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GraphLayout {
    nodes: Vec<NodeGeometry>,
    bounds: WorldRect,
}

impl GraphLayout {
    pub fn nodes(&self) -> &[NodeGeometry] {
        &self.nodes
    }

    pub fn node(&self, id: &TaskId) -> Option<&NodeGeometry> {
        self.nodes.iter().find(|node| node.id == *id)
    }

    pub const fn bounds(&self) -> WorldRect {
        self.bounds
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CacheDecision {
    Recomputed,
    Reused,
}

#[derive(Default)]
pub struct LayoutCache {
    fingerprint: Option<crate::TopologyFingerprint>,
    layout: Option<GraphLayout>,
}

impl LayoutCache {
    pub fn update(&mut self, model: &GraphModel) -> CacheDecision {
        if self.fingerprint.as_ref() == Some(model.topology_fingerprint()) {
            return CacheDecision::Reused;
        }
        self.layout = Some(build_layout(model));
        self.fingerprint = Some(model.topology_fingerprint().clone());
        CacheDecision::Recomputed
    }

    pub fn layout(&self) -> Option<&GraphLayout> {
        self.layout.as_ref()
    }
}

fn build_layout(model: &GraphModel) -> GraphLayout {
    if model.canonical_ids().is_empty() {
        return GraphLayout {
            nodes: Vec::new(),
            bounds: WorldRect::new(-1.0, -1.0, 1.0, 1.0),
        };
    }
    let nodes = if model.dependency_cyclic() {
        grid_layout(model.canonical_ids())
    } else {
        layered_layout(model)
    };
    let bounds = layout_bounds(&nodes);
    GraphLayout { nodes, bounds }
}

fn layered_layout(model: &GraphModel) -> Vec<NodeGeometry> {
    let orientation = Orientation::TopToBottom;
    let mut visual = VisualGraph::new(orientation);
    let mut handles = BTreeMap::new();
    for id in model.canonical_ids() {
        let element = Element {
            shape: ShapeKind::None,
            pos: Position::new(
                Point::zero(),
                Point::new(NODE_WIDTH, NODE_HEIGHT),
                Point::zero(),
                Point::new(4.0, 2.0),
            ),
            look: StyleAttr::simple(),
            orientation,
            properties: None,
        };
        handles.insert(id.clone(), visual.add_node(element));
    }
    for edge in model.canonical_edges() {
        visual.add_edge(Arrow::invisible(), handles[&edge.from], handles[&edge.to]);
    }
    visual.do_it(false, false, false, &mut NullBackend);

    model
        .canonical_ids()
        .iter()
        .map(|id| {
            let center = visual.pos(handles[id]).center();
            NodeGeometry::new(
                id.to_task_id(),
                WorldPoint::new(center.x, -center.y),
                NODE_WIDTH,
                NODE_HEIGHT,
            )
        })
        .collect()
}

fn grid_layout(ids: &[CanonicalTaskId]) -> Vec<NodeGeometry> {
    let mut columns = 1usize;
    while columns.saturating_mul(columns) < ids.len() {
        columns += 1;
    }
    ids.iter()
        .enumerate()
        .map(|(index, id)| {
            let column = index % columns;
            let row = index / columns;
            NodeGeometry::new(
                id.to_task_id(),
                WorldPoint::new(
                    column as f64 * (NODE_WIDTH + BOUNDS_PADDING),
                    -(row as f64 * (NODE_HEIGHT + BOUNDS_PADDING)),
                ),
                NODE_WIDTH,
                NODE_HEIGHT,
            )
        })
        .collect()
}

fn layout_bounds(nodes: &[NodeGeometry]) -> WorldRect {
    let first = &nodes[0];
    let mut min_x = first.center.x - first.width / 2.0;
    let mut max_x = first.center.x + first.width / 2.0;
    let mut min_y = first.center.y - first.height / 2.0;
    let mut max_y = first.center.y + first.height / 2.0;
    for node in &nodes[1..] {
        min_x = min_x.min(node.center.x - node.width / 2.0);
        max_x = max_x.max(node.center.x + node.width / 2.0);
        min_y = min_y.min(node.center.y - node.height / 2.0);
        max_y = max_y.max(node.center.y + node.height / 2.0);
    }
    WorldRect::new(
        min_x - BOUNDS_PADDING,
        min_y - BOUNDS_PADDING,
        max_x + BOUNDS_PADDING,
        max_y + BOUNDS_PADDING,
    )
}

struct NullBackend;

impl RenderBackend for NullBackend {
    fn draw_rect(
        &mut self,
        _: Point,
        _: Point,
        _: &StyleAttr,
        _: Option<String>,
        _: Option<ClipHandle>,
    ) {
    }

    fn draw_line(&mut self, _: Point, _: Point, _: &StyleAttr, _: Option<String>) {}

    fn draw_circle(&mut self, _: Point, _: Point, _: &StyleAttr, _: Option<String>) {}

    fn draw_text(&mut self, _: Point, _: &str, _: &StyleAttr) {}

    fn draw_arrow(
        &mut self,
        _: &[(Point, Point)],
        _: bool,
        _: (bool, bool),
        _: &StyleAttr,
        _: Option<String>,
        _: &str,
    ) {
    }

    fn create_clip(&mut self, _: Point, _: Point, _: usize) -> ClipHandle {
        0
    }
}
