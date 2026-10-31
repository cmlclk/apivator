import { describe, expect, it } from 'vitest';
import { useEnvironmentStore } from './environmentStore';

describe('environment deposu', () => {
  it('bozuk yerel kayıt uygulamayı çökertmez', async () => {
    localStorage.setItem('apivator-env', '{"state":{"active":"çöp","currentValues":[1,2]},"version":0}');
    await useEnvironmentStore.persist.rehydrate();
    expect(useEnvironmentStore.getState().active).toEqual({});
    expect(useEnvironmentStore.getState().currentValues).toEqual({});
  });

  it('aktif environment ve güncel değerleri saklar, siler', () => {
    const { setActive, setCurrentValues, forgetScope } = useEnvironmentStore.getState();
    setActive('w1', 'e1');
    setCurrentValues('env:e1', { token: 'x' });
    expect(useEnvironmentStore.getState().active.w1).toBe('e1');
    expect(useEnvironmentStore.getState().currentValues['env:e1']).toEqual({ token: 'x' });

    forgetScope('env:e1');
    expect(useEnvironmentStore.getState().currentValues['env:e1']).toBeUndefined();
  });
});
