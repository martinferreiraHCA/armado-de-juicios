// Definiciones de proveedores de IA. Compartido por content.js, popup.js y
// background.js. Cada proveedor expone:
//   - label / apiKeyHint / apiKeyUrl    → datos para la UI
//   - models[]                          → lista de modelos disponibles
//   - url(model, key) / headers(key)    → cómo armar el request
//   - body(model, system, userMsg, max) → cuerpo del request
//   - extract(data)                     → cómo sacar el texto de la respuesta

const SIGED_PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    apiKeyHint: 'sk-ant-...',
    apiKeyUrl: 'https://console.anthropic.com',
    free: false,
    models: [
      { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (mejor calidad, más caro)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido)' },
    ],
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
    extract: (data) => ((data && data.content) || []).map((b) => b.text || '').join('').trim(),
  },

  openai: {
    label: 'OpenAI (GPT)',
    apiKeyHint: 'sk-...',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    free: false,
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o mini (barato)' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({
      'content-type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
    extract: (data) => (((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')).trim(),
  },

  google: {
    label: 'Google Gemini · plan gratuito disponible',
    apiKeyHint: 'AIza...',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    free: true,
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (gratis)' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (gratis)' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (límites más bajos)' },
    ],
    url: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    headers: () => ({ 'content-type': 'application/json' }),
    body: (_model, system, userMsg, maxTokens) => ({
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
    extract: (data) => {
      const cand = data && data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      return (((parts || []).map((p) => p.text || '').join('')) || '').trim();
    },
  },

  groq: {
    label: 'Groq · gratis con límites de tasa',
    apiKeyHint: 'gsk_...',
    apiKeyUrl: 'https://console.groq.com/keys',
    free: true,
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (gratis)' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (rápido, gratis)' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (gratis)' },
      { value: 'gemma2-9b-it', label: 'Gemma 2 9B (gratis)' },
    ],
    url: () => 'https://api.groq.com/openai/v1/chat/completions',
    headers: (key) => ({
      'content-type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
    extract: (data) => (((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')).trim(),
  },

  openrouter: {
    label: 'OpenRouter · multi-modelo, varios gratis',
    apiKeyHint: 'sk-or-...',
    apiKeyUrl: 'https://openrouter.ai/keys',
    free: true,
    models: [
      { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (gratis)' },
      { value: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash exp (gratis)' },
      { value: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (gratis)' },
      { value: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (gratis)' },
      { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (paga)' },
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (paga)' },
    ],
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
    headers: (key) => ({
      'content-type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/martinferreirahca/armado-de-juicios',
      'X-Title': 'SIGED Juicios IA',
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
    extract: (data) => (((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')).trim(),
  },

  mistral: {
    label: 'Mistral AI · plan gratuito disponible',
    apiKeyHint: '...',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    free: true,
    models: [
      { value: 'open-mistral-nemo', label: 'Open Mistral Nemo (gratis)' },
      { value: 'mistral-small-latest', label: 'Mistral Small' },
      { value: 'mistral-large-latest', label: 'Mistral Large' },
    ],
    url: () => 'https://api.mistral.ai/v1/chat/completions',
    headers: (key) => ({
      'content-type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
    extract: (data) => (((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '')).trim(),
  },

  cohere: {
    label: 'Cohere · plan gratuito de prueba',
    apiKeyHint: '...',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    free: true,
    models: [
      { value: 'command-r7b-12-2024', label: 'Command R7B (rápido, gratis trial)' },
      { value: 'command-r-plus', label: 'Command R+' },
    ],
    url: () => 'https://api.cohere.com/v2/chat',
    headers: (key) => ({
      'content-type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
    }),
    extract: (data) => {
      const msg = data && data.message;
      const content = msg && msg.content;
      if (Array.isArray(content)) return content.map((c) => c.text || '').join('').trim();
      return (msg && msg.text || '').trim();
    },
  },
};

// Lista plana ordenada para UIs.
const SIGED_PROVIDER_LIST = Object.keys(SIGED_PROVIDERS).map((id) => ({
  id,
  ...SIGED_PROVIDERS[id],
}));
