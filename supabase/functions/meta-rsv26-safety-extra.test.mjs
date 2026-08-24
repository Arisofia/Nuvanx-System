import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDesiredCreative } from '../../scripts/lib/meta-rsv26.js';

const defaults = {
  page_id: 'page',
  instagram_user_id: 'instagram',
  lead_gen_form_id: 'form',
  cta_type: 'APPLY_NOW',
};

const item = {
  key: 'media_guard',
  body: 'Body',
  headline: 'Headline',
  description: 'Description',
};

function sourceWith(assetFeedSpec) {
  return {
    asset_feed_spec: {
      bodies: [{ text: 'old' }],
      titles: [{ text: 'old' }],
      descriptions: [{ text: 'old' }],
      call_to_actions: [{}],
      ...assetFeedSpec,
    },
    object_story_spec: { page_id: 'old-page', instagram_user_id: 'old-ig' },
  };
}

describe('RSV26 source creative media guard', () => {
  it('rejects empty image and video arrays', () => {
    expect(() => buildDesiredCreative(sourceWith({ images: [], videos: [] }), item, defaults))
      .toThrow('configured source creative has no image or video assets');
  });

  it('rejects non-array media shapes even when they expose a positive length', () => {
    expect(() => buildDesiredCreative(sourceWith({ images: 'x', videos: [] }), item, defaults))
      .toThrow('configured source creative has no image or video assets');
    expect(() => buildDesiredCreative(sourceWith({ images: [], videos: { length: 1 } }), item, defaults))
      .toThrow('configured source creative has no image or video assets');
  });

  it('accepts a non-empty image array', () => {
    expect(buildDesiredCreative(sourceWith({ images: [{ hash: 'image' }], videos: [] }), item, defaults).asset_feed_spec.images)
      .toEqual([{ hash: 'image' }]);
  });

  it('accepts a non-empty video array', () => {
    expect(buildDesiredCreative(sourceWith({ images: [], videos: [{ video_id: 'video' }] }), item, defaults).asset_feed_spec.videos)
      .toEqual([{ video_id: 'video' }]);
  });
});

describe('RSV26 live asset audit fail-closed contract', () => {
  it('treats a critical object without a proven matching id as failure', () => {
    const source = readFileSync('scripts/meta-access-audit.js', 'utf8');
    expect(source).toContain("const objectMismatch = mode === 'object' && result.id_match !== true");
    expect(source).not.toContain("const objectMismatch = mode === 'object' && result.id_match === false");
  });
});
