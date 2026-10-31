import { useDeferredValue, useMemo, useState } from 'react';
import { CornerDownLeft, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@apivator/ui';
import { LINE_OP_DEFAULTS, applyLineOps, type LineOp, type LineOpsResult } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane, TwoPanes } from '../ToolLayout';
import { toolErrorText } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { LINE_OP_KINDS, LINE_OP_LABELS, parseSteps } from './lineOpsModel';
import { StepRow } from './lineOpsSteps';
import { TextStatsPanel } from './TextStatsPanel';

const ID = 'line-ops';
/** Geri alma geçmişi; her kayıt tüm metni tuttuğundan kısa tutulur. */
const MAX_UNDO = 10;

interface Snapshot {
  input: string;
  steps: string;
}

export default function LineOpsTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(ID, 'input');
  const [stepsJson, setStepsJson] = useToolInput(ID, 'steps', '[]');
  const [undo, setUndo] = useState<Snapshot[]>([]);
  // Karıştırma her hesapta yeniden yapılır; bu sayaç "Yeniden karıştır" ile değişir.
  const [shuffleNonce, setShuffleNonce] = useState(0);
  const steps = useMemo(() => parseSteps(stepsJson), [stepsJson]);
  const deferredInput = useDeferredValue(input);
  // Filtre metni gibi adım seçenekleri de her tuşta 5 MB zinciri yeniden çalıştırmasın.
  const deferredSteps = useDeferredValue(steps);
  /** Çıktı henüz son girdi/adımlarla hesaplanmadı; bu sırada girdiye uygulamak yazılanı kaybettirir. */
  const stale = deferredInput !== input || deferredSteps !== steps;

  const { result, error } = useMemo((): { result: LineOpsResult | null; error: string | null } => {
    void shuffleNonce;
    try {
      return { result: applyLineOps(deferredInput, deferredSteps), error: null };
    } catch (caught) {
      return { result: null, error: toolErrorText(caught) };
    }
  }, [deferredInput, deferredSteps, shuffleNonce]);
  const output = result?.text ?? '';

  const saveSteps = (next: LineOp[]) => setStepsJson(JSON.stringify(next));
  const updateStep = (index: number, step: LineOp) =>
    saveSteps(steps.map((s, i) => (i === index ? step : s)));
  const moveStep = (index: number, delta: -1 | 1) => {
    const next = [...steps];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    saveSteps(next);
  };

  /** Çıktıyı girdiye yazar ve zinciri boşaltır (aynı adımlar ikinci kez uygulanmasın). */
  const applyToInput = () => {
    if (!result || !steps.length || stale) return;
    setUndo((u) => [...u, { input, steps: stepsJson }].slice(-MAX_UNDO));
    setInput(output);
    setStepsJson('[]');
  };
  const undoLast = () => {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    setInput(last.input);
    setStepsJson(last.steps);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ToolOptions>
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t('lineOps.addStep')}
        </span>
        {LINE_OP_KINDS.map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="secondary"
            onClick={() => saveSteps([...steps, LINE_OP_DEFAULTS[kind]])}
          >
            {LINE_OP_LABELS[kind]}
          </Button>
        ))}
      </ToolOptions>
      {steps.length > 0 && (
        <ol className="flex max-h-64 flex-col gap-1 overflow-auto" aria-label={t('lineOps.steps')}>
          {steps.map((step, index) => (
            <StepRow
              key={index}
              index={index}
              count={steps.length}
              step={step}
              removed={result?.steps[index]?.removed}
              onChange={(next) => updateStep(index, next)}
              onMove={(delta) => moveStep(index, delta)}
              onRemove={() => saveSteps(steps.filter((_, i) => i !== index))}
              onReshuffle={() => setShuffleNonce((n) => n + 1)}
            />
          ))}
        </ol>
      )}
      <ToolOptions>
        <Button size="sm" disabled={!steps.length || !result || stale} onClick={applyToInput}>
          <CornerDownLeft className="h-3.5 w-3.5" /> {t('lineOps.applyToInput')}
        </Button>
        <Button size="sm" variant="secondary" disabled={!undo.length} onClick={undoLast}>
          <Undo2 className="h-3.5 w-3.5" /> {t('lineOps.undo')}
        </Button>
        <Button size="sm" variant="ghost" disabled={!steps.length} onClick={() => saveSteps([])}>
          <Trash2 className="h-3.5 w-3.5" /> {t('lineOps.clearSteps')}
        </Button>
        <span className="text-xs text-fg-subtle">{t('lineOps.hint')}</span>
      </ToolOptions>
      <ToolErrorMessage error={error} />
      <TwoPanes>
        <ToolPane
          label={t('lineOps.input')}
          value={input}
          onChange={setInput}
          placeholder={t('lineOps.placeholder')}
          fileAccept=""
        />
        <ToolPane
          label={t('lineOps.output')}
          value={output}
          output
          downloadName={t('lineOps.downloadName')}
        />
      </TwoPanes>
      <TextStatsPanel text={output} compact label={t('lineOps.outputStats')} />
    </div>
  );
}
