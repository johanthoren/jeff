use crate::{layout::NodeGeometry, topology::CanonicalTaskId};
use jeff_project::TaskId;

const MIN_ZOOM: f64 = 0.25;
const MAX_ZOOM: f64 = 8.0;
const MIN_INTERSECTION_RATIO: f64 = 0.2;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WorldPoint {
    pub x: f64,
    pub y: f64,
}

impl WorldPoint {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ViewPoint {
    pub x: f64,
    pub y: f64,
}

impl ViewPoint {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CellPoint {
    pub x: u16,
    pub y: u16,
}

impl CellPoint {
    pub const fn new(x: u16, y: u16) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WorldRect {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl WorldRect {
    pub const fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    pub fn width(self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(self) -> f64 {
        self.max_y - self.min_y
    }
}

#[derive(Clone, Debug)]
pub struct Viewport {
    world_bounds: WorldRect,
    pan: WorldPoint,
    zoom: f64,
    canvas_width: u16,
    canvas_height: u16,
}

impl Viewport {
    pub fn new(world_bounds: WorldRect, canvas_width: u16, canvas_height: u16) -> Self {
        let mut viewport = Self {
            world_bounds,
            pan: WorldPoint::new(world_bounds.min_x, world_bounds.max_y),
            zoom: 1.0,
            canvas_width,
            canvas_height,
        };
        viewport.clamp_pan();
        viewport
    }

    pub const fn world_bounds(&self) -> WorldRect {
        self.world_bounds
    }

    pub const fn pan(&self) -> WorldPoint {
        self.pan
    }

    pub const fn zoom(&self) -> f64 {
        self.zoom
    }

    pub const fn canvas_size(&self) -> (u16, u16) {
        (self.canvas_width, self.canvas_height)
    }

    pub fn visible_world(&self) -> WorldRect {
        WorldRect::new(
            self.pan.x,
            self.pan.y - f64::from(self.canvas_height) / self.zoom,
            self.pan.x + f64::from(self.canvas_width) / self.zoom,
            self.pan.y,
        )
    }

    pub fn world_to_view(&self, world: WorldPoint) -> ViewPoint {
        ViewPoint::new(
            (world.x - self.pan.x) * self.zoom,
            (self.pan.y - world.y) * self.zoom,
        )
    }

    pub fn view_to_world(&self, view: ViewPoint) -> WorldPoint {
        WorldPoint::new(
            self.pan.x + view.x / self.zoom,
            self.pan.y - view.y / self.zoom,
        )
    }

    pub fn world_to_cell(&self, world: WorldPoint) -> Option<CellPoint> {
        let view = self.world_to_view(world);
        if view.x < 0.0
            || view.y < 0.0
            || view.x >= f64::from(self.canvas_width)
            || view.y >= f64::from(self.canvas_height)
        {
            return None;
        }
        Some(CellPoint::new(view.x.floor() as u16, view.y.floor() as u16))
    }

    pub fn cell_to_world(&self, cell: CellPoint) -> WorldPoint {
        self.view_to_world(ViewPoint::new(
            f64::from(cell.x) + 0.5,
            f64::from(cell.y) + 0.5,
        ))
    }

    pub fn set_zoom_at(&mut self, requested_zoom: f64, cursor: CellPoint) {
        let anchor = self.cell_to_world(cursor);
        self.zoom = requested_zoom.clamp(MIN_ZOOM, MAX_ZOOM);
        self.pan.x = anchor.x - (f64::from(cursor.x) + 0.5) / self.zoom;
        self.pan.y = anchor.y + (f64::from(cursor.y) + 0.5) / self.zoom;
        self.clamp_pan();
    }

    pub fn pan_by_cells(&mut self, dx: f64, dy: f64) {
        self.pan.x += dx / self.zoom;
        self.pan.y -= dy / self.zoom;
        self.clamp_pan();
    }

    pub fn resize(&mut self, canvas_width: u16, canvas_height: u16) {
        self.canvas_width = canvas_width;
        self.canvas_height = canvas_height;
        self.clamp_pan();
    }

    fn clamp_pan(&mut self) {
        let visible_width = f64::from(self.canvas_width) / self.zoom;
        let visible_height = f64::from(self.canvas_height) / self.zoom;
        let overlap_width = (visible_width * MIN_INTERSECTION_RATIO).min(self.world_bounds.width());
        let overlap_height =
            (visible_height * MIN_INTERSECTION_RATIO).min(self.world_bounds.height());
        self.pan.x = self.pan.x.clamp(
            self.world_bounds.min_x + overlap_width - visible_width,
            self.world_bounds.max_x - overlap_width,
        );
        self.pan.y = self.pan.y.clamp(
            self.world_bounds.min_y + overlap_height,
            self.world_bounds.max_y - overlap_height + visible_height,
        );
    }
}

pub fn hit_test(viewport: &Viewport, cell: CellPoint, nodes: &[NodeGeometry]) -> Option<TaskId> {
    let point = viewport.cell_to_world(cell);
    let mut best: Option<&NodeGeometry> = None;
    for node in nodes.iter().filter(|node| node.contains(point)) {
        let replace = match best {
            None => true,
            Some(current) if node.area() < current.area() => true,
            Some(current) if node.area() == current.area() => {
                CanonicalTaskId::from_task_id(&node.id) > CanonicalTaskId::from_task_id(&current.id)
            }
            Some(_) => false,
        };
        if replace {
            best = Some(node);
        }
    }
    best.map(|node| node.id.clone())
}
