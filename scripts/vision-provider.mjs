/**
 * Provider interface for the BINI archive intelligence layer.
 *
 * This starter provider is deterministic and non-destructive. It does not
 * pretend to perform face recognition. Replace/extend these methods with a
 * local ONNX/Human/InsightFace provider once the reference-face library exists.
 */

export async function analyzeImage({ imageBuffer, record }) {
  const hasPeopleHint = /\b(person|people|member|bini|aiah|colet|gwen|jhoanna|maloi|mikha|stacey|sheena)\b/i.test(
    `${record?.title || ''} ${(record?.tags || []).join(' ')}`
  );

  const category = record?.category || 'Archive';
  const likelyPersonContext = [
    'Photoshoot', 'Events', 'Candid', 'Media', 'Awards', 'Music', 'Brand', 'BTS'
  ].includes(category);

  return {
    provider: 'starter-heuristics',
    faces: [],
    members: [],
    objects: [],
    scene: category,
    activity: null,
    shotType: null,
    expression: null,
    pose: null,
    clothing: [],
    colors: [],
    peopleCount: null,
    unknownPeopleCount: null,
    signals: {
      hasPeopleHint,
      likelyPersonContext,
      imageBytes: imageBuffer.length,
    },
  };
}
