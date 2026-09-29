// Amazon Nova through the Bedrock Converse API.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export function bedrockModel({ textModelId, visionModelId }) {
  if (!textModelId || !visionModelId) {
    throw new Error('TEXT_MODEL_ID and VISION_MODEL_ID must be set');
  }
  const client = new BedrockRuntimeClient({});

  async function converse(modelId, system, content, maxTokens, temperature) {
    const res = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content }],
        inferenceConfig: { maxTokens, temperature },
      }),
    );
    return res.output.message.content.map((c) => c.text ?? '').join('').trim();
  }

  return {
    text: ({ system, input, maxTokens = 200, temperature = 0.8 }) =>
      converse(textModelId, system, [{ text: input }], maxTokens, temperature),
    vision: ({ system, input, image }) =>
      converse(
        visionModelId,
        system,
        [{ image: { format: image.format, source: { bytes: image.bytes } } }, { text: input }],
        1500,
        0.2,
      ),
  };
}
