use crate::{EdgeKind, GraphLayout, GraphModel, Viewport};
use jeff_project::TaskId;
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::Color,
    symbols::Marker,
    widgets::{
        canvas::{Canvas, Line, Points, Rectangle},
        Widget,
    },
};

pub struct GraphCanvas<'a> {
    model: &'a GraphModel,
    layout: &'a GraphLayout,
    viewport: &'a Viewport,
    selected: Option<&'a TaskId>,
}

impl<'a> GraphCanvas<'a> {
    pub const fn new(
        model: &'a GraphModel,
        layout: &'a GraphLayout,
        viewport: &'a Viewport,
    ) -> Self {
        Self {
            model,
            layout,
            viewport,
            selected: None,
        }
    }

    pub fn selected(mut self, selected: Option<&'a TaskId>) -> Self {
        self.selected = selected;
        self
    }
}

impl Widget for GraphCanvas<'_> {
    fn render(self, area: Rect, buffer: &mut Buffer) {
        let bounds = self.viewport.visible_world();
        Canvas::default()
            .x_bounds([bounds.min_x, bounds.max_x])
            .y_bounds([bounds.min_y, bounds.max_y])
            .marker(Marker::Dot)
            .paint(|context| {
                for edge in self.model.edges() {
                    let (Some(from), Some(to)) =
                        (self.layout.node(&edge.from), self.layout.node(&edge.to))
                    else {
                        continue;
                    };
                    let color = match edge.kind {
                        EdgeKind::Dependency => Color::DarkGray,
                        EdgeKind::Discovery => Color::Cyan,
                    };
                    context.draw(&Line::new(
                        from.center.x,
                        from.center.y,
                        to.center.x,
                        to.center.y,
                        color,
                    ));
                }

                context.layer();
                for node in self.layout.nodes() {
                    context.draw(&Rectangle::new(
                        node.center.x - node.width / 2.0,
                        node.center.y - node.height / 2.0,
                        node.width,
                        node.height,
                        Color::White,
                    ));
                    context.draw(&Points::new(
                        &[(node.center.x, node.center.y)],
                        Color::White,
                    ));
                }

                context.layer();
                if let Some(selected) = self.selected.and_then(|id| self.layout.node(id)) {
                    context.draw(&Rectangle::new(
                        selected.center.x - selected.width / 2.0 - 0.5,
                        selected.center.y - selected.height / 2.0 - 0.5,
                        selected.width + 1.0,
                        selected.height + 1.0,
                        Color::Yellow,
                    ));
                    context.draw(&Points::new(
                        &[(selected.center.x, selected.center.y)],
                        Color::Yellow,
                    ));
                }
            })
            .render(area, buffer);
    }
}
