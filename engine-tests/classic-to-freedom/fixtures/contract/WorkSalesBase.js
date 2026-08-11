// Contract layer 7/9. The original stand body carried no golden-asserted behaviour of its own (with it
// emptied every check still passes — State is inserted by an earlier layer and removed by layer 9), and it
// was the last remaining duplicated block, so it is trimmed to an empty layer. Kept in the F1 chain so the
// nine-layer ordering test still merges nine layers. See fixtures/README.md.
define("ContractPageV2", [], function() {
	return { entitySchemaName: "Contract", diff: [], rules: {}, businessRules: {}, details: {}, methods: {} };
});
