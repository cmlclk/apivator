import type { NavigateFunction } from 'react-router';
import { useToolsStore } from './toolsStore';

/**
 * Metni aracın ana girdisine (`input` alanı) yazar ve araca gider.
 * Yanıt panelindeki "Araçlarda aç" ve akıllı yapıştırma bunu kullanır.
 */
export function openInTool(navigate: NavigateFunction, toolId: string, text: string) {
  useToolsStore.getState().setInput(toolId, 'input', text);
  void navigate(`/tools/${toolId}`);
}
