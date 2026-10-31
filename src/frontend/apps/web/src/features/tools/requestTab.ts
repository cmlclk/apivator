import type { NavigateFunction } from 'react-router';
import { emptyDefinition, type CodeRequest } from '@apivator/core';
import { translate } from '../../i18n';
import { useTabs } from '../requests/tabsStore';

/**
 * Araçta çözülen isteği (cURL, HAR kaydı) istek çalışma alanında yeni sekme olarak açar.
 * `warnings` varsa sekmede uyarı olarak gösterilir.
 */
export function openRequestTab(
  navigate: NavigateFunction,
  workspaceId: string,
  request: CodeRequest,
  warnings: string[] = [],
) {
  useTabs.getState().newTab(workspaceId, {
    name: request.url.replace(/^https?:\/\//i, '').slice(0, 80) || translate('tools', 'request.fromTool'),
    draft: { ...emptyDefinition(), ...request },
    notice: warnings.length
      ? { tone: 'warning', text: translate('tools', 'request.curlSkipped'), details: warnings }
      : undefined,
  });
  void navigate('/');
}
