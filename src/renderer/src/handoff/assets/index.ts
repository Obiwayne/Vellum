// Assets pipeline entry (T64 / H4). Two steps so a dialog can show counts before anything heavy runs:
//   const plan = await planAssets(doc, { frames, measure })           // pure: records, original bytes, jobs
//   const result = await runAssetJobs(plan, planScreenPngs(specJson), engine)   // edge: resample, PNG
// and `buildHandoff(doc, { assets: plan.records, warnings: plan.warnings, ... })` lists them in spec.json and the markdown.
export { planAssets, DEFAULT_LIMITS, JPEG_QUALITY, type AssetPlan, type PlanOptions, type ResizeJob } from './plan'
export { runAssetJobs, planScreenPngs, markMissing, canvasEngine, type AssetEngine, type PngJob, type RunOptions, type RunResult } from './run'
export { fontSourceFor, type FontKnowledge } from './fonts'
export { dataUrlToBytes, sniff, sha256Hex, type Sniffed } from './bytes'
export { densities, targetSize, type DensityPlan } from './density'
export { optimiseSvg, monochrome, iconDocument, unsafeSvg, type IconResult } from './svgIcon'
