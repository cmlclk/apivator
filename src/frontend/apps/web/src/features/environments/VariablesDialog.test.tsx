import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VariablesDialog } from './VariablesDialog';

const setup = (onSave = vi.fn().mockResolvedValue(undefined)) => {
  const onClose = vi.fn();
  render(
    <VariablesDialog
      title="Environment: Geliştirme"
      description="açıklama"
      name="Geliştirme"
      variables={[
        { key: 'baseUrl', value: 'http://localhost:5000', enabled: true, isSecret: false },
        { key: 'token', value: '', enabled: true, isSecret: true },
      ]}
      currentValues={{ token: 'eski-yerel' }}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose, user: userEvent.setup() };
};

describe('VariablesDialog', () => {
  it('gizli değişkenleri maskeler, istenince gösterir', async () => {
    const { user } = setup();
    expect(screen.getByLabelText('Güncel değer 2')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Gizli değerleri göster' }));
    expect(screen.getByLabelText('Güncel değer 2')).toHaveAttribute('type', 'text');
  });

  it('başlangıç değerlerini sunucuya, güncel değerleri yalnızca yerele ayırır', async () => {
    const { user, onSave, onClose } = setup();

    await user.clear(screen.getByLabelText('Güncel değer 2'));
    await user.type(screen.getByLabelText('Güncel değer 2'), 'yeni-token');
    await user.type(screen.getByLabelText('Değişken adı 3'), 'userId');
    await user.type(screen.getByLabelText('Başlangıç değeri 3'), '42');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Geliştirme',
      variables: [
        { key: 'baseUrl', value: 'http://localhost:5000', enabled: true, isSecret: false },
        { key: 'token', value: '', enabled: true, isSecret: true },
        { key: 'userId', value: '42', enabled: true, isSecret: false },
      ],
      // Boş güncel değer kaydedilmez: başlangıç değeri kullanılır.
      currentValues: { token: 'yeni-token' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('aynı adla iki değişkene izin vermez', async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText('Değişken adı 3'), 'baseUrl');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"baseUrl" adlı değişken birden fazla kez tanımlı.',
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
