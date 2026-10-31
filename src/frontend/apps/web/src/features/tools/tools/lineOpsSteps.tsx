import { ArrowDown, ArrowUp, Shuffle, X } from 'lucide-react';
import { Button, cn } from '@apivator/ui';
import type { LineOp } from '@apivator/core/tools';
import { useT } from '../../../i18n';
import { CodecCheckbox, CodecSelect } from '../CodecTool';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { LINE_OP_LABELS } from './lineOpsModel';

const textInputClass = cn(toolSelectClass, 'w-28 font-mono');

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <label className={toolLabelClass}>
      {label}
      <input
        type={type}
        className={cn(textInputClass, type === 'number' && 'w-20')}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const check = (value: boolean) => (value ? '1' : '');

/** Adımın türe özel seçenekleri. */
function StepOptions({ step, onChange }: { step: LineOp; onChange: (step: LineOp) => void }) {
  const t = useT('toolsMisc');
  switch (step.kind) {
    case 'sort':
      return (
        <>
          <CodecSelect
            label={t('lineOps.criterion')}
            value={step.mode}
            onChange={(mode) => onChange({ ...step, mode: mode as typeof step.mode })}
            choices={[
              ['alpha', t('lineOps.alpha')],
              ['natural', t('lineOps.natural')],
              ['length', t('lineOps.length')],
            ]}
          />
          <CodecSelect
            label={t('lineOps.direction')}
            value={step.descending ? 'desc' : 'asc'}
            onChange={(v) => onChange({ ...step, descending: v === 'desc' })}
            choices={[
              ['asc', 'A → Z'],
              ['desc', 'Z → A'],
            ]}
          />
          <CodecSelect
            label={t('lineOps.language')}
            value={step.locale}
            onChange={(locale) => onChange({ ...step, locale: locale as typeof step.locale })}
            choices={[
              ['tr', t('lineOps.turkish')],
              ['en', t('lineOps.english')],
              ['raw', t('lineOps.codeOrder')],
            ]}
          />
          <CodecCheckbox
            label={t('lineOps.ignoreCase')}
            value={check(step.ignoreCase)}
            onChange={(v) => onChange({ ...step, ignoreCase: v === '1' })}
          />
        </>
      );
    case 'unique':
      return (
        <>
          <CodecCheckbox
            label={t('lineOps.ignoreCase')}
            value={check(step.ignoreCase)}
            onChange={(v) => onChange({ ...step, ignoreCase: v === '1' })}
          />
          <CodecCheckbox
            label={t('lineOps.ignoreWhitespace')}
            value={check(step.ignoreWhitespace)}
            onChange={(v) => onChange({ ...step, ignoreWhitespace: v === '1' })}
          />
        </>
      );
    case 'remove-empty':
      return (
        <CodecCheckbox
          label={t('lineOps.whitespaceOnly')}
          value={check(step.whitespaceOnly)}
          onChange={(v) => onChange({ ...step, whitespaceOnly: v === '1' })}
        />
      );
    case 'affix':
      return (
        <>
          <TextField
            label={t('lineOps.prefix')}
            value={step.prefix}
            onChange={(prefix) => onChange({ ...step, prefix })}
          />
          <TextField
            label={t('lineOps.suffix')}
            value={step.suffix}
            onChange={(suffix) => onChange({ ...step, suffix })}
          />
        </>
      );
    case 'number':
      return (
        <>
          <TextField
            label={t('lineOps.start')}
            type="number"
            value={String(step.start)}
            onChange={(v) => onChange({ ...step, start: Number(v) })}
          />
          <TextField
            label={t('lineOps.separator')}
            value={step.separator}
            onChange={(separator) => onChange({ ...step, separator })}
          />
          <CodecCheckbox
            label={t('lineOps.zeroPad')}
            value={check(step.pad)}
            onChange={(v) => onChange({ ...step, pad: v === '1' })}
          />
        </>
      );
    case 'join':
    case 'split':
      return (
        <TextField
          label={t('lineOps.separator')}
          value={step.separator}
          placeholder="\t, \n"
          onChange={(separator) => onChange({ ...step, separator })}
        />
      );
    case 'filter':
      return (
        <>
          <CodecSelect
            label={t('lineOps.lines')}
            value={step.keep ? 'keep' : 'drop'}
            onChange={(v) => onChange({ ...step, keep: v === 'keep' })}
            choices={[
              ['keep', t('lineOps.keepMatching')],
              ['drop', t('lineOps.dropMatching')],
            ]}
          />
          <TextField
            label={t('lineOps.text')}
            value={step.text}
            onChange={(text) => onChange({ ...step, text })}
          />
          <CodecCheckbox
            label={t('lineOps.ignoreCase')}
            value={check(step.ignoreCase)}
            onChange={(v) => onChange({ ...step, ignoreCase: v === '1' })}
          />
        </>
      );
    case 'wrap':
      return (
        <TextField
          label={t('lineOps.width')}
          type="number"
          value={String(step.width)}
          onChange={(v) => onChange({ ...step, width: Number(v) })}
        />
      );
    default:
      return null;
  }
}

/** Zincirdeki bir adımın satırı: sıra, ad, seçenekler, sonuç ve taşıma/silme düğmeleri. */
export function StepRow({
  index,
  count,
  step,
  removed,
  onChange,
  onMove,
  onRemove,
  onReshuffle,
}: {
  index: number;
  count: number;
  step: LineOp;
  removed?: number;
  onChange: (step: LineOp) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onReshuffle: () => void;
}) {
  const t = useT('toolsMisc');
  const name = LINE_OP_LABELS[step.kind];
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-line px-2 py-1">
      <span className="font-mono text-xs text-fg-subtle">{index + 1}.</span>
      <span className="text-xs font-semibold text-fg">{name}</span>
      <StepOptions step={step} onChange={onChange} />
      {step.kind === 'shuffle' && (
        <Button size="sm" variant="ghost" onClick={onReshuffle}>
          <Shuffle className="h-3.5 w-3.5" /> {t('lineOps.reshuffle')}
        </Button>
      )}
      {removed !== undefined && (
        <span className="text-xs text-fg-muted">{t('lineOps.removed', { count: removed })}</span>
      )}
      <div className="flex-1" />
      <Button
        size="icon"
        variant="ghost"
        title={t('lineOps.moveUp')}
        aria-label={t('lineOps.moveUpNamed', { name })}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={t('lineOps.moveDown')}
        aria-label={t('lineOps.moveDownNamed', { name })}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={t('lineOps.removeStep')}
        aria-label={t('lineOps.removeNamed', { name })}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
