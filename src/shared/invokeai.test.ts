import { describe, expect, it } from 'vitest'
import { OUTPUT_NODE, buildTextToImageGraph, findOutputImage, normalizeInvokeUrl } from './invokeai'

const base = { prompt: 'a cat', negative: 'blurry', width: 513, height: 768, steps: 20, cfgScale: 7, scheduler: 'euler', seed: 42 }
const model = (b: string) => ({ key: 'k', hash: 'h', name: 'm', base: b, type: 'main' })
type G = ReturnType<typeof buildTextToImageGraph>
const edgesTo = (g: G, node: string): string[] =>
  (g.edges as Array<{ source: { node_id: string; field: string }; destination: { node_id: string; field: string } }>)
    .filter((e) => e.destination.node_id === node)
    .map((e) => `${e.source.node_id}.${e.source.field}->${e.destination.field}`)
    .sort()

describe('normalizeInvokeUrl', () => {
  it('adds http and strips trailing slashes', () => {
    expect(normalizeInvokeUrl('127.0.0.1:9090/')).toBe('http://127.0.0.1:9090')
    expect(normalizeInvokeUrl(' https://gpu.local/invoke/ ')).toBe('https://gpu.local/invoke')
  })
  it('rejects other schemes and credentials', () => {
    expect(normalizeInvokeUrl('file:///c:/x')).toBeNull()
    expect(normalizeInvokeUrl('http://u:p@host')).toBeNull()
    expect(normalizeInvokeUrl('')).toBeNull()
    expect(normalizeInvokeUrl(5)).toBeNull()
  })
})

describe('buildTextToImageGraph', () => {
  it('SD 1.x: main loader, compel prompts, size snapped to multiples of 8', () => {
    const g = buildTextToImageGraph({ ...base, model: model('sd-1') })
    expect((g.nodes.model as { type: string }).type).toBe('main_model_loader')
    expect((g.nodes.pos as { type: string; prompt: string }).prompt).toBe('a cat')
    expect((g.nodes.neg as { prompt: string }).prompt).toBe('blurry')
    expect(g.nodes.noise).toMatchObject({ type: 'noise', width: 512, height: 768, seed: 42 })
    expect(g.nodes[OUTPUT_NODE]).toMatchObject({ type: 'l2i', is_intermediate: false })
    expect(edgesTo(g, 'denoise')).toEqual([
      'model.unet->unet',
      'neg.conditioning->negative_conditioning',
      'noise.noise->noise',
      'pos.conditioning->positive_conditioning'
    ])
    expect(edgesTo(g, OUTPUT_NODE)).toEqual(['denoise.latents->latents', 'model.vae->vae'])
    for (const id of Object.keys(g.nodes)) expect((g.nodes[id] as { id: string }).id).toBe(id)
  })
  it('SDXL: sdxl loader and both text encoders', () => {
    const g = buildTextToImageGraph({ ...base, width: 1024, height: 1024, model: model('sdxl') })
    expect((g.nodes.model as { type: string }).type).toBe('sdxl_model_loader')
    expect(g.nodes.pos).toMatchObject({ type: 'sdxl_compel_prompt', target_width: 1024, original_height: 1024 })
    expect(edgesTo(g, 'pos')).toEqual(['model.clip->clip', 'model.clip2->clip2'])
  })
})

describe('findOutputImage', () => {
  it('follows source_prepared_mapping', () => {
    const item = {
      session: {
        source_prepared_mapping: { [OUTPUT_NODE]: ['p2'] },
        results: { p1: { image: { image_name: 'other.png' } }, p2: { image: { image_name: 'out.png' } } }
      }
    }
    expect(findOutputImage(item)).toBe('out.png')
  })
  it('falls back to any image result, else null', () => {
    expect(findOutputImage({ session: { results: { a: { latents: {} }, b: { image: { image_name: 'x.png' } } } } })).toBe('x.png')
    expect(findOutputImage({})).toBeNull()
  })
})
