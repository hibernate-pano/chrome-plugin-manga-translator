/**
 * Ready-made provider presets.
 *
 * The extension lets a user point the OpenAI-compatible slot at any service
 * that speaks the protocol — which is exactly right, and exactly the problem.
 * "Base URL" and "model" are two things a new user has to know before the
 * extension does anything at all, and neither is guessable: a wrong model name
 * fails at the first request with an error that says nothing useful.
 *
 * So the settings page offers the common services as one click. The preset
 * fills in the endpoint and the model; the user still pastes their own key.
 * The endpoint and the model in each preset are the service's own documented
 * vision-capable defaults.
 *
 * The list is deliberately short. A preset that names a model the service has
 * retired is worse than no preset, so every entry here is one that a user
 * could type by hand. The service names line up with `provider-label.ts`, so
 * a preset and a hand-typed URL for the same service are labelled the same
 * way in the UI.
 */

export interface ProviderPreset {
  /** Stable id, used as the React key and to detect a re-selected preset. */
  id: string;
  /** The name the user recognises from their own bill. */
  label: string;
  /** The service's OpenAI-compatible endpoint. */
  baseUrl: string;
  /** A vision-capable model the service documents. */
  model: string;
  /** Where the user gets an API key. */
  keyUrl: string;
  /** One line on why someone would pick this service. */
  note: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3',
    keyUrl:
      'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    note: '扩展的默认后端，开箱即用。',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '硅基流动，国内直连，视觉模型多，按量计费。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    // A free tier that accepts image input. The `:free` suffix is the
    // documented way to reach a model at no cost; the free model list rotates,
    // so a paid sibling is a better default for a preset that has to keep
    // working.
    model: 'qwen/qwen2.5-vl-72b-instruct',
    keyUrl: 'https://openrouter.ai/keys',
    note: '一个 Key 调用多家模型，模型列表最全。',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    note: 'Google AI Studio，需在控制台开启 OpenAI 兼容端点。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '通用性强，小模型也够用。',
  },
];

/**
 * Find the preset that matches what the user has configured.
 *
 * A preset is only "selected" when the endpoint *and* the model both match:
 * someone who typed the same endpoint with a different model has not chosen
 * this preset, and highlighting it would misreport what they are about to be
 * billed for.
 */
export function findMatchingPreset(args: {
  baseUrl: string;
  model: string;
}): ProviderPreset | null {
  const baseUrl = (args.baseUrl ?? '').trim().replace(/\/+$/, '');
  const model = (args.model ?? '').trim();
  if (!baseUrl) {
    return null;
  }
  for (const preset of PROVIDER_PRESETS) {
    if (
      preset.baseUrl.replace(/\/+$/, '').toLowerCase() ===
        baseUrl.toLowerCase() &&
      preset.model.toLowerCase() === model.toLowerCase()
    ) {
      return preset;
    }
  }
  return null;
}
