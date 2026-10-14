// The build-time reconcile modes for an existing-Freedom reconcile, in one dependency-free module so both the
// task layer (tasks.mjs) and the spec/verify layer (designspec.mjs) can name them without an import cycle.
//   overlay        — add the client delta onto the existing Freedom layout; keep base positions/extras (default).
//   classic-layout — place fields/details at their Classic positions (move base, remove base layout elements not in
//                    the plan, keep Freedom-only value-add and the standard components).
export const RECONCILE_MODE_OVERLAY = "overlay";
export const RECONCILE_MODE_CLASSIC = "classic-layout";
// The canonical ORDER, so a printed list is stable without a comparator-less `.sort()`.
export const RECONCILE_MODE_LIST = [RECONCILE_MODE_OVERLAY, RECONCILE_MODE_CLASSIC];
export const RECONCILE_MODES = new Set(RECONCILE_MODE_LIST);
export const RECONCILE_MODE_DEFAULT = RECONCILE_MODE_OVERLAY;
