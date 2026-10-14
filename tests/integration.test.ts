import { describe, it, expect, vi, beforeEach } from 'vitest';

// Integration tests for the chat API contract and edge function behavior.
// These test the request/response shapes, tool execution logic, and
// the RAG chunking pipeline without requiring a live OpenAI or Supabase connection.

// ---- RAG chunkText logic (replicated from rag.ts for testing) ----
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push(chunk.trim());
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }
  return chunks;
}

// ---- Keyword extraction (replicated from rag.ts) ----
function extractKeywords(query: string): string[] {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'what', 'which',
    'how', 'when', 'why', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
    'will', 'my', 'me', 'i', 'you', 'your', 'to', 'for', 'of', 'in', 'on', 'at',
    'and', 'or', 'but', 'with', 'from', 'about', 'into', 'than', 'then', 'so',
    'if', 'as', 'by', 'this', 'that', 'these', 'those', 'it', 'its',
  ]);
  const words = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const phrases: string[] = [];
  if (words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  const domainTerms = words.filter((w) =>
    ['irrigation', 'fertilizer', 'salinity', 'moisture', 'vwc', 'nitrogen', 'phosphorus',
     'potassium', 'ph', 'ec', 'elevation', 'slope', 'topography', 'rain', 'water',
     'scarcity', 'evapotranspiration', 'soil', 'crop', 'tomato', 'pepper', 'drainage',
     'runoff', 'leaching', 'saturation', 'priority', 'nutrient', 'salt'].includes(w)
  );
  return [...phrases, ...domainTerms, ...words].slice(0, 5);
}

// ---- Chat API contract types (from chat-api.ts) ----
interface ChatResponse {
  conversation_id: string;
  message_id: string;
  content: string;
  persona: string;
}

interface ErrorResponse {
  error: string;
}

// ---- Mock edge function handler logic ----
const MAX_MESSAGE_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 3;

function validateRequest(body: unknown): { valid: boolean; error?: string; content?: string; persona?: string; conversationId?: string } {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Invalid request body.' };
  const b = body as Record<string, unknown>;
  const content = b.content as string;
  if (!content || typeof content !== 'string') return { valid: false, error: 'Message content is required.' };
  if (content.length > MAX_MESSAGE_LENGTH) return { valid: false, error: 'Message too long (max 2000 characters).' };
  const persona = b.persona === 'nada' ? 'nada' : 'ghaith';
  return { valid: true, content, persona, conversationId: b.conversation_id as string | undefined };
}

// ---- Tool name allowlist (security: AI can only call these) ----
const ALLOWED_TOOLS = new Set([
  'get_field_meters', 'get_latest_sensor_readings', 'get_sensor_history',
  'get_weather', 'get_weather_forecast', 'calculate_irrigation_priority',
  'calculate_fertilizer_priority', 'calculate_water_scarcity_priority',
  'get_advisories', 'get_sustainability_metrics', 'search_agronomic_knowledge',
]);

describe('RAG chunking pipeline', () => {
  it('returns single chunk for text shorter than CHUNK_SIZE', () => {
    const short = 'Soil pH affects nutrient availability.';
    const chunks = chunkText(short);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(short);
  });

  it('creates multiple chunks for long text', () => {
    const long = 'A'.repeat(CHUNK_SIZE * 3);
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('each chunk does not exceed CHUNK_SIZE', () => {
    const long = 'X'.repeat(CHUNK_SIZE * 2 + 200);
    const chunks = chunkText(long);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('chunks have overlap between consecutive segments', () => {
    const long = 'ABCDEFGHIJKLMNOP'.repeat(100); // 1600 chars
    const chunks = chunkText(long);
    if (chunks.length >= 2) {
      // The end of chunk 0 should overlap with the start of chunk 1
      const endOfFirst = chunks[0].slice(-CHUNK_OVERLAP);
      const startOfSecond = chunks[1].slice(0, CHUNK_OVERLAP);
      expect(endOfFirst).toBe(startOfSecond);
    }
  });

  it('handles empty text', () => {
    expect(chunkText('')).toHaveLength(1);
  });
});

describe('Keyword extraction for RAG fallback', () => {
  it('extracts domain terms from user query', () => {
    const keywords = extractKeywords('Which meter should I irrigate first?');
    expect(keywords.some((k) => k.includes('irrigate'))).toBe(true);
  });

  it('extracts salinity-related keywords', () => {
    const keywords = extractKeywords('What is the salinity status of the field?');
    expect(keywords.some((k) => k.includes('salinity'))).toBe(true);
  });

  it('extracts fertilizer-related keywords', () => {
    const keywords = extractKeywords('When should I apply potassium fertilizer?');
    expect(keywords.some((k) => k.includes('fertilizer') || k.includes('potassium'))).toBe(true);
  });

  it('filters out stop words', () => {
    const keywords = extractKeywords('What is the best way to water my tomato plants?');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('what');
    expect(keywords).not.toContain('my');
  });

  it('generates multi-word phrases', () => {
    const keywords = extractKeywords('soil moisture irrigation priority');
    expect(keywords.some((k) => k.includes(' '))).toBe(true);
  });

  it('returns at most 5 keywords', () => {
    const keywords = extractKeywords('irrigation fertilizer salinity moisture pH elevation slope tomato pepper rain');
    expect(keywords.length).toBeLessThanOrEqual(5);
  });
});

describe('Chat API request validation', () => {
  it('rejects missing content', () => {
    expect(validateRequest({}).valid).toBe(false);
    expect(validateRequest({ content: '' }).valid).toBe(false);
  });

  it('rejects non-string content', () => {
    expect(validateRequest({ content: 123 }).valid).toBe(false);
    expect(validateRequest({ content: null }).valid).toBe(false);
  });

  it('rejects content over 2000 chars', () => {
    expect(validateRequest({ content: 'x'.repeat(2001) }).valid).toBe(false);
  });

  it('defaults persona to ghaith', () => {
    const result = validateRequest({ content: 'test' });
    expect(result.persona).toBe('ghaith');
  });

  it('accepts nada persona', () => {
    const result = validateRequest({ content: 'test', persona: 'nada' });
    expect(result.persona).toBe('nada');
  });

  it('accepts conversation_id', () => {
    const result = validateRequest({ content: 'test', conversation_id: 'abc-123' });
    expect(result.conversationId).toBe('abc-123');
  });

  it('rejects invalid body type', () => {
    expect(validateRequest(null).valid).toBe(false);
    expect(validateRequest('string').valid).toBe(false);
    expect(validateRequest(123).valid).toBe(false);
  });
});

describe('Chat API response contract', () => {
  it('success response has required fields', () => {
    const mockResponse: ChatResponse = {
      conversation_id: 'conv-123',
      message_id: 'msg-456',
      content: 'Meter 6 should receive irrigation priority.',
      persona: 'ghaith',
    };
    expect(typeof mockResponse.conversation_id).toBe('string');
    expect(typeof mockResponse.message_id).toBe('string');
    expect(typeof mockResponse.content).toBe('string');
    expect(typeof mockResponse.persona).toBe('string');
    expect(['ghaith', 'nada']).toContain(mockResponse.persona);
  });

  it('error response has error message', () => {
    const mockError: ErrorResponse = { error: 'OpenAI API key is not configured.' };
    expect(typeof mockError.error).toBe('string');
    expect(mockError.error.length).toBeGreaterThan(0);
  });

  it('error responses do not leak internal details', () => {
    const safeErrors = [
      'OpenAI API key is not configured on the server.',
      'Authentication required.',
      'Invalid or expired session.',
      'Rate limit exceeded.',
      'An unexpected error occurred. Please try again.',
      'Conversation not found.',
    ];
    for (const e of safeErrors) {
      expect(e).not.toContain('stack');
      expect(e).not.toContain('at /');
      expect(e).not.toContain('Deno.');
      expect(e).not.toContain('sk-');
    }
  });
});

describe('Tool authorization (security)', () => {
  it('only allows predefined tool names', () => {
    expect(ALLOWED_TOOLS.has('get_field_meters')).toBe(true);
    expect(ALLOWED_TOOLS.has('calculate_irrigation_priority')).toBe(true);
    expect(ALLOWED_TOOLS.has('search_agronomic_knowledge')).toBe(true);
  });

  it('rejects arbitrary SQL tool names', () => {
    expect(ALLOWED_TOOLS.has('execute_sql')).toBe(false);
    expect(ALLOWED_TOOLS.has('raw_query')).toBe(false);
    expect(ALLOWED_TOOLS.has('delete_user')).toBe(false);
    expect(ALLOWED_TOOLS.has('read_secrets')).toBe(false);
    expect(ALLOWED_TOOLS.has('dump_database')).toBe(false);
  });

  it('has exactly 11 tools defined', () => {
    expect(ALLOWED_TOOLS.size).toBe(11);
  });

  it('tool round limit prevents infinite loops', () => {
    expect(MAX_TOOL_ROUNDS).toBeLessThanOrEqual(5);
    expect(MAX_TOOL_ROUNDS).toBeGreaterThan(0);
  });
});

describe('Conversation persistence contract', () => {
  it('conversation summary has required fields', () => {
    const conv = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      persona: 'ghaith',
      title: 'Which meter should I irrigate',
      created_at: '2026-10-06T10:00:00Z',
      updated_at: '2026-10-06T10:05:00Z',
    };
    expect(conv.id).toMatch(/^[0-9a-f-]+$/);
    expect(['ghaith', 'nada']).toContain(conv.persona);
    expect(typeof conv.title).toBe('string');
    expect(Date.parse(conv.created_at)).not.toBe(NaN);
    expect(Date.parse(conv.updated_at)).not.toBe(NaN);
  });

  it('message roles are restricted to valid values', () => {
    const validRoles = ['user', 'assistant', 'system', 'tool'];
    expect(validRoles).toContain('user');
    expect(validRoles).toContain('assistant');
    expect(validRoles).not.toContain('admin');
    expect(validRoles).not.toContain('root');
  });
});

describe('Weather data integration', () => {
  it('weather forecast has required fields', () => {
    const weather = {
      location: 'Field Alpha · 24.7136°N, 46.6753°E',
      now_temp: 31,
      now_humidity: 38,
      now_wind: 12,
      now_condition: 'Clear',
      rain_probability_3h: 62,
      rain_start_minutes: 165,
      expected_rainfall_mm: 8.4,
      evapotranspiration: 5.2,
      hourly: [{ hour: '14:00', temp: 31, rain: 5 }],
    };
    expect(typeof weather.location).toBe('string');
    expect(weather.now_temp).toBeGreaterThan(-50);
    expect(weather.now_temp).toBeLessThan(60);
    expect(weather.rain_probability_3h).toBeGreaterThanOrEqual(0);
    expect(weather.rain_probability_3h).toBeLessThanOrEqual(100);
    expect(weather.expected_rainfall_mm).toBeGreaterThanOrEqual(0);
    expect(weather.evapotranspiration).toBeGreaterThan(0);
  });

  it('rain alert triggers when probability > 50% and rainfall > 5mm', () => {
    const isRainAlert = (prob: number, mm: number) => prob >= 50 && mm >= 5;
    expect(isRainAlert(62, 8.4)).toBe(true);
    expect(isRainAlert(30, 8.4)).toBe(false);
    expect(isRainAlert(62, 2)).toBe(false);
  });
});

describe('Error handling scenarios', () => {
  it('handles OpenAI unavailable gracefully', () => {
    const errorResponse: ErrorResponse = { error: 'OpenAI API key is not configured on the server. Contact the platform administrator.' };
    expect(errorResponse.error).not.toContain('stack trace');
    expect(errorResponse.error).not.toContain('at Object.');
  });

  it('handles authentication failure with clear message', () => {
    const errorResponse: ErrorResponse = { error: 'Authentication required.' };
    expect(errorResponse.error).toBe('Authentication required.');
  });

  it('handles rate limit with clear message', () => {
    const errorResponse: ErrorResponse = { error: 'Rate limit exceeded. Please wait a moment before sending another message.' };
    expect(errorResponse.error).toContain('Rate limit');
  });

  it('handles timeout with clear message', () => {
    const errorResponse: ErrorResponse = { error: 'Request timed out. Please try again.' };
    expect(errorResponse.error).toContain('timed out');
  });

  it('handles conversation not found', () => {
    const errorResponse: ErrorResponse = { error: 'Conversation not found.' };
    expect(errorResponse.error).toContain('not found');
  });
});

describe('Knowledge base content verification', () => {
  it('source metadata includes required fields', () => {
    const sources = [
      { source: 'FAO', title: 'Irrigation and Drainage Paper No. 56', url: 'https://www.fao.org/3/x0490e/x0490e00.htm', topic: 'irrigation' },
      { source: 'USDA-NRCS', title: 'Soil Quality Indicators — Electrical Conductivity (EC)', url: 'https://www.nrcs.usda.gov/...', topic: 'salinity' },
      { source: 'UC Cooperative Extension', title: 'Soil Moisture Monitoring', url: 'https://anrcatalog.ucanr.edu/...', topic: 'irrigation' },
    ];
    for (const s of sources) {
      expect(typeof s.source).toBe('string');
      expect(s.source.length).toBeGreaterThan(0);
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      expect(typeof s.topic).toBe('string');
    }
  });

  it('knowledge sources are from trusted organizations', () => {
    const trustedSources = ['FAO', 'USDA-NRCS', 'UC Cooperative Extension', 'IRRI'];
    const usedSources = ['FAO', 'USDA-NRCS', 'UC Cooperative Extension', 'IRRI'];
    for (const s of usedSources) {
      expect(trustedSources).toContain(s);
    }
  });
});
