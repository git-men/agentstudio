import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockContext = vi.hoisted(() => {
  const storage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllSkills: vi.fn().mockResolvedValue([]),
    getUserSkills: vi.fn().mockResolvedValue([]),
    getProjectSkills: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockResolvedValue(null),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    getSkillDirectoryInfo: vi.fn(),
    validateSkillManifest: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  };

  return {
    storage,
    getEngineType: vi.fn(),
    isCursorEngine: vi.fn(),
    isCodebuddyEngine: vi.fn(),
    isCodexEngine: vi.fn(),
  };
});

vi.mock('../../services/skillStorage', () => ({
  SkillStorage: vi.fn().mockImplementation(() => mockContext.storage),
}));

vi.mock('../../config/engineConfig', () => ({
  getEngineType: mockContext.getEngineType,
  isCursorEngine: mockContext.isCursorEngine,
  isCodebuddyEngine: mockContext.isCodebuddyEngine,
  isCodexEngine: mockContext.isCodexEngine,
}));

describe('skills route read-only behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.getEngineType.mockReturnValue('codex-cli');
    mockContext.isCursorEngine.mockReturnValue(false);
    mockContext.isCodebuddyEngine.mockReturnValue(false);
    mockContext.isCodexEngine.mockReturnValue(true);
    mockContext.storage.getAllSkills.mockResolvedValue([]);
  });

  async function createApp() {
    const app = express();
    app.use(express.json());
    const skillsRouter = (await import('../skills')).default;
    app.use('/api/skills', skillsRouter);
    return app;
  }

  it('GET /api/skills returns readOnly metadata for codex', async () => {
    const app = await createApp();

    const response = await request(app)
      .get('/api/skills')
      .expect(200);

    expect(response.body.readOnly).toBe(true);
    expect(response.body.engine).toBe('codex-cli');
    expect(Array.isArray(response.body.skills)).toBe(true);
  });

  it('POST /api/skills is blocked in read-only mode', async () => {
    const app = await createApp();

    const response = await request(app)
      .post('/api/skills')
      .send({
        name: 'demo-skill',
        description: 'demo',
        scope: 'user',
        content: '---\nname: demo-skill\ndescription: demo\n---\n\ncontent',
      })
      .expect(403);

    expect(response.body.error).toBe('Read-only mode');
    expect(mockContext.storage.createSkill).not.toHaveBeenCalled();
  });

  it('PUT /api/skills/:id/files/* is blocked in read-only mode', async () => {
    const app = await createApp();

    const response = await request(app)
      .put('/api/skills/demo/files/SKILL.md')
      .send({ content: 'updated' })
      .expect(403);

    expect(response.body.error).toBe('Read-only mode');
    expect(mockContext.storage.getSkill).not.toHaveBeenCalled();
  });
});
