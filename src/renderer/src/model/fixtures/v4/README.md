`buttons-v4.json` is a doc at DOC_VERSION 4 (variants). It was made with the model code of commit 5393cd8 (the T18 merge,
the only commit with DOC_VERSION 4): makeDoc, createComponent, createVariant twice, pickMain and createInstance, written
with JSON.stringify as the app saves docs. At that commit nothing in the store, the UI or the MCP tools could create a
variant set, so the app itself could not have saved one; the model functions were the only route.
