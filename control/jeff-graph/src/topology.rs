use jeff_project::{Snapshot, SnapshotTask, TaskId};
use petgraph::{
    algo::{has_path_connecting, is_cyclic_directed},
    stable_graph::{NodeIndex, StableDiGraph},
};
use std::collections::{btree_map::Entry, BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum EdgeKind {
    Dependency,
    Discovery,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphEdge {
    pub from: TaskId,
    pub to: TaskId,
    pub kind: EdgeKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Degradation {
    MissingDependency {
        dependent: TaskId,
        dependency: TaskId,
    },
    CyclicDiscovery {
        from: TaskId,
        to: TaskId,
    },
    CyclicDependencies,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SelectionDirection {
    Forward,
    Backward,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum CanonicalTaskId {
    Number(u64),
    String(String),
}

impl CanonicalTaskId {
    pub(crate) fn from_task_id(id: &TaskId) -> Self {
        match id {
            TaskId::Number(value) => Self::Number(*value),
            TaskId::String(value) => Self::String(value.clone()),
        }
    }

    pub(crate) fn to_task_id(&self) -> TaskId {
        match self {
            Self::Number(value) => TaskId::Number(*value),
            Self::String(value) => TaskId::String(value.clone()),
        }
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct FingerprintEdge {
    pub(crate) from: CanonicalTaskId,
    pub(crate) to: CanonicalTaskId,
    pub(crate) kind: EdgeKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TopologyFingerprint {
    ids: Vec<CanonicalTaskId>,
    edges: Vec<FingerprintEdge>,
}

pub struct GraphModel {
    graph: StableDiGraph<SnapshotTask, EdgeKind>,
    task_ids: Vec<TaskId>,
    edges: Vec<GraphEdge>,
    degradations: Vec<Degradation>,
    fingerprint: TopologyFingerprint,
    dependency_cyclic: bool,
}

impl GraphModel {
    pub fn from_snapshot(snapshot: &Snapshot) -> Self {
        let mut tasks: Vec<&SnapshotTask> = snapshot.tasks.iter().collect();
        tasks.sort_by_key(|task| CanonicalTaskId::from_task_id(&task.id));

        let mut graph = StableDiGraph::new();
        let mut indices = BTreeMap::new();
        for task in &tasks {
            let key = CanonicalTaskId::from_task_id(&task.id);
            if let Entry::Vacant(entry) = indices.entry(key) {
                entry.insert(graph.add_node((*task).clone()));
            }
        }

        let mut edge_set = BTreeSet::new();
        let mut missing = BTreeSet::new();
        for task in &tasks {
            let dependent = CanonicalTaskId::from_task_id(&task.id);
            for dependency in &task.deps {
                let dependency = CanonicalTaskId::from_task_id(dependency);
                if indices.contains_key(&dependency) {
                    edge_set.insert(FingerprintEdge {
                        from: dependency,
                        to: dependent.clone(),
                        kind: EdgeKind::Dependency,
                    });
                } else {
                    missing.insert((dependent.clone(), dependency));
                }
            }
        }
        add_edges(&mut graph, &indices, &edge_set);
        let dependency_cyclic = is_cyclic_directed(&graph);

        let mut degradations: Vec<Degradation> = missing
            .into_iter()
            .map(|(dependent, dependency)| Degradation::MissingDependency {
                dependent: dependent.to_task_id(),
                dependency: dependency.to_task_id(),
            })
            .collect();
        if dependency_cyclic {
            degradations.push(Degradation::CyclicDependencies);
        }

        let mut discoveries = BTreeSet::new();
        for task in &tasks {
            if let Some(from) = &task.discovered_from {
                let from = CanonicalTaskId::from_task_id(from);
                let to = CanonicalTaskId::from_task_id(&task.id);
                if indices.contains_key(&from) && indices.contains_key(&to) {
                    discoveries.insert((from, to));
                }
            }
        }
        for (from, to) in discoveries {
            let from_index = indices[&from];
            let to_index = indices[&to];
            if has_path_connecting(&graph, to_index, from_index, None) {
                degradations.push(Degradation::CyclicDiscovery {
                    from: from.to_task_id(),
                    to: to.to_task_id(),
                });
            } else {
                graph.add_edge(from_index, to_index, EdgeKind::Discovery);
                edge_set.insert(FingerprintEdge {
                    from,
                    to,
                    kind: EdgeKind::Discovery,
                });
            }
        }

        let ids: Vec<CanonicalTaskId> = indices.keys().cloned().collect();
        let fingerprint_edges: Vec<FingerprintEdge> = edge_set.into_iter().collect();
        let task_ids = ids.iter().map(CanonicalTaskId::to_task_id).collect();
        let edges = fingerprint_edges
            .iter()
            .map(|edge| GraphEdge {
                from: edge.from.to_task_id(),
                to: edge.to.to_task_id(),
                kind: edge.kind,
            })
            .collect();

        Self {
            graph,
            task_ids,
            edges,
            degradations,
            fingerprint: TopologyFingerprint {
                ids,
                edges: fingerprint_edges,
            },
            dependency_cyclic,
        }
    }

    pub fn graph(&self) -> &StableDiGraph<SnapshotTask, EdgeKind> {
        &self.graph
    }

    pub fn task_ids(&self) -> &[TaskId] {
        &self.task_ids
    }

    pub fn edges(&self) -> &[GraphEdge] {
        &self.edges
    }

    pub fn degradations(&self) -> &[Degradation] {
        &self.degradations
    }

    pub fn topology_fingerprint(&self) -> &TopologyFingerprint {
        &self.fingerprint
    }

    pub fn navigate(
        &self,
        selected: Option<&TaskId>,
        direction: SelectionDirection,
    ) -> Option<&TaskId> {
        if self.task_ids.is_empty() {
            return None;
        }
        let current = selected
            .map(CanonicalTaskId::from_task_id)
            .and_then(|id| self.fingerprint.ids.binary_search(&id).ok());
        let index = match (current, direction) {
            (Some(index), SelectionDirection::Forward) => (index + 1) % self.task_ids.len(),
            (Some(0), SelectionDirection::Backward) => self.task_ids.len() - 1,
            (Some(index), SelectionDirection::Backward) => index - 1,
            (None, SelectionDirection::Forward) => 0,
            (None, SelectionDirection::Backward) => self.task_ids.len() - 1,
        };
        Some(&self.task_ids[index])
    }

    pub(crate) fn canonical_ids(&self) -> &[CanonicalTaskId] {
        &self.fingerprint.ids
    }

    pub(crate) fn canonical_edges(&self) -> &[FingerprintEdge] {
        &self.fingerprint.edges
    }

    pub(crate) fn dependency_cyclic(&self) -> bool {
        self.dependency_cyclic
    }
}

fn add_edges(
    graph: &mut StableDiGraph<SnapshotTask, EdgeKind>,
    indices: &BTreeMap<CanonicalTaskId, NodeIndex>,
    edges: &BTreeSet<FingerprintEdge>,
) {
    for edge in edges {
        graph.add_edge(indices[&edge.from], indices[&edge.to], edge.kind);
    }
}
