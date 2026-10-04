# Director character and asset locks

Use **Treatment → Character Locks** to select or upload up to three reference images before building a treatment. Each slot has a name, notes, and an active toggle. The same library is available in Shot Plan and Advanced Editor.

Add asset locks for vehicles, wardrobe, props, locations, products, or style references. The library can contain many assets; each shot supports up to eight total reference images, including its characters. Generation reports an error instead of dropping excess references.

The Director assigns active lock IDs while creating or revising a treatment. In **Shot Plan**, review or change the character and asset checkboxes on each shot. You can also set its hero flag and continuity notes. No selected characters means an environment, object, or abstract shot without people. At least one valid active character must exist in the project before Director generation, even when individual shots use none.

Only assigned references enter storyboard generation. Assigned identities and asset details override conflicting generic descriptions. Agnes video takes use the approved storyboard as the first frame and the same shot assignments in their animation instructions; the current video endpoint takes one first-frame image, not a separate multi-image reference list.

Changing locks or assignments clears affected approvals and media. Deleted or disabled locks are removed from assignments. Old in-flight storyboard results and cancelled video jobs cannot replace updated shots. Reference consistency is instructed through provider inputs; review generated images before approving the takes.

Old character and vehicle reference IDs migrate to character slots and vehicle asset locks. Saved projects retain the library, per-shot assignments, and explicit empty selections. Legacy shots without assignment fields inherit their previous global references until edited.
