import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { trimInputs, useToolInput, useToolsStore } from './toolsStore';

const state = () => useToolsStore.getState();
const persisted = () =>
  JSON.parse(localStorage.getItem('apivator-tools') ?? '{}') as {
    state?: { inputs?: Record<string, Record<string, string>>; recent?: string[] };
  };

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('toolsStore', () => {
  it('favori ekleyip çıkarır', () => {
    state().toggleFavorite('jwt');
    state().toggleFavorite('base64');
    expect(state().favorites).toEqual(['jwt', 'base64']);
    state().toggleFavorite('jwt');
    expect(state().favorites).toEqual(['base64']);
  });

  it('son kullanılanlar: en yeni başta, tekrarsız, en fazla 8', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) state().markUsed(id);
    expect(state().recent).toEqual(['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c']);
    state().markUsed('e');
    expect(state().recent).toEqual(['e', 'j', 'i', 'h', 'g', 'f', 'd', 'c']);
    expect(state().recent).toHaveLength(8);
  });

  it('girdiler araç bazında saklanır; clearInputs tek aracı ya da hepsini siler', () => {
    state().setInput('jwt', 'input', 'token');
    state().setInput('jwt', 'secret', 'gizli', false);
    state().setInput('base64', 'input', 'abc');
    expect(state().inputs).toEqual({ jwt: { input: 'token' }, base64: { input: 'abc' } });
    expect(state().volatile).toEqual({ jwt: { secret: 'gizli' } });

    state().clearInputs('jwt');
    expect(state().inputs).toEqual({ base64: { input: 'abc' } });
    expect(state().volatile).toEqual({});

    state().setInput('jwt', 'secret', 'gizli', false);
    state().clearInputs();
    expect(state().inputs).toEqual({});
    expect(state().volatile).toEqual({});
  });

  it('gizli (remember=false) alanlar diske yazılmaz', () => {
    state().setInput('jwt', 'input', 'token');
    state().setInput('jwt', 'secret', 'gizli', false);
    const saved = localStorage.getItem('apivator-tools') ?? '';
    expect(saved).toContain('token');
    expect(saved).not.toContain('gizli');
    expect(saved).not.toContain('volatile');
  });

  it('HAR girdisi bellekte kalır ama diske yazılmaz (çerez/Authorization içerir)', () => {
    state().setInput('har', 'input', '{"log":{"entries":[{"cookie":"oturum=gizli"}]}}');
    state().setInput('base64', 'input', 'abc');
    expect(state().inputs.har?.input).toContain('oturum=gizli');
    const saved = localStorage.getItem('apivator-tools') ?? '';
    expect(saved).toContain('abc');
    expect(saved).not.toContain('oturum=gizli');
  });

  it('rememberInputs=false girdileri siler ve diske yazmaz', () => {
    state().setInput('base64', 'input', 'abc');
    state().setRememberInputs(false);
    expect(state().rememberInputs).toBe(false);
    expect(state().inputs).toEqual({});

    state().setInput('base64', 'input', 'yeni');
    expect(state().inputs).toEqual({ base64: { input: 'yeni' } });
    expect(persisted().state?.inputs).toEqual({});

    state().setRememberInputs(true);
    expect(state().inputs).toEqual({ base64: { input: 'yeni' } });
  });

  it('trimInputs çok büyük alanları ve toplam sınırı aşanları düşürür', () => {
    const big = 'x'.repeat(200_001);
    expect(trimInputs({ a: { input: big, small: 'ok' } })).toEqual({ a: { small: 'ok' } });

    const half = 'y'.repeat(150_000);
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i}`, { input: half }]));
    const trimmed = trimInputs({ ...many, z: { input: 'küçük' } });
    expect(trimmed.z).toEqual({ input: 'küçük' });
    const total = Object.values(trimmed).reduce(
      (sum, fields) => sum + Object.values(fields).reduce((s, v) => s + v.length, 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(1_000_000);
    expect(Object.keys(trimmed).length).toBeLessThan(9);
  });
});

describe('useToolInput', () => {
  it('başlangıç değeri, güncelleme ve volatile alan', () => {
    const { result } = renderHook(() => ({
      input: useToolInput('url', 'input', 'varsayılan'),
      key: useToolInput('url', 'key', '', { remember: false }),
    }));
    expect(result.current.input[0]).toBe('varsayılan');
    act(() => result.current.input[1]('a b'));
    act(() => result.current.key[1]('s3cr3t'));
    expect(result.current.input[0]).toBe('a b');
    expect(result.current.key[0]).toBe('s3cr3t');
    expect(state().inputs.url).toEqual({ input: 'a b' });
    expect(state().volatile.url).toEqual({ key: 's3cr3t' });
  });
});
