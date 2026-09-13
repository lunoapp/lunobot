import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;

vi.mock('./config.js', () => ({
  get GROUPS_DIR() {
    return path.join(root, 'groups');
  },
}));

vi.mock('./log.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

vi.mock('./container-config.js', async () => {
  const actual = await vi.importActual<typeof import('./container-config.js')>('./container-config.js');
  return {
    ...actual,
    readContainerConfig: (folder: string) => {
      const p = path.join(root, 'groups', folder, 'container.json');
      const raw = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
      return { mcpServers: {}, packages: { apt: [], npm: [] }, additionalMounts: [], skills: raw.skills ?? 'all' };
    },
  };
});

const { composeGroupClaudeMd } = await import('./claude-md-compose.js');

function writeSkill(name: string, withInstructions: boolean): void {
  const dir = path.join(root, 'container', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  if (withInstructions) fs.writeFileSync(path.join(dir, 'instructions.md'), `# ${name}\n`);
}

function writeGroup(folder: string, config: object): void {
  const dir = path.join(root, 'groups', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'container.json'), JSON.stringify(config));
}

function composedImports(folder: string): string[] {
  return fs
    .readFileSync(path.join(root, 'groups', folder, 'CLAUDE.md'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('@'));
}

describe('composeGroupClaudeMd skill fragments', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    writeSkill('team-persona', true);
    writeSkill('onecli-gateway', true);
    writeSkill('no-fragment', false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('imports every skill fragment when the group selects all skills', () => {
    writeGroup('g_all', { skills: 'all' });
    composeGroupClaudeMd({ folder: 'g_all' } as never);
    expect(composedImports('g_all')).toEqual([
      '@./.claude-shared.md',
      '@./.claude-fragments/skill-onecli-gateway.md',
      '@./.claude-fragments/skill-team-persona.md',
    ]);
  });

  it('imports only the fragments of skills the group selects', () => {
    writeGroup('g_some', { skills: ['onecli-gateway'] });
    composeGroupClaudeMd({ folder: 'g_some' } as never);
    expect(composedImports('g_some')).toEqual(['@./.claude-shared.md', '@./.claude-fragments/skill-onecli-gateway.md']);
  });

  it('prunes a fragment link once its skill is deselected', () => {
    writeGroup('g_prune', { skills: 'all' });
    composeGroupClaudeMd({ folder: 'g_prune' } as never);
    writeGroup('g_prune', { skills: ['onecli-gateway'] });
    composeGroupClaudeMd({ folder: 'g_prune' } as never);
    expect(fs.readdirSync(path.join(root, 'groups', 'g_prune', '.claude-fragments')).sort()).toEqual([
      'skill-onecli-gateway.md',
    ]);
  });
});
