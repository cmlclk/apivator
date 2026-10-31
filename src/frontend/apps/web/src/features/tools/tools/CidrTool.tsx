import { useMemo } from 'react';
import {
  analyzeIpInput,
  cidrContains,
  splitCidr,
  type CidrInfo,
  type IpInputResult,
  type SubnetSplit,
} from '@apivator/core/tools';
import { formatNumber, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';
import { NoteList } from './netToolParts';

const TOOL = 'cidr';
const SPLIT_LIMIT = 256;
const count = (n: bigint) =>
  n < 10n ** 15n ? formatNumber(n) : `${n.toString()} (2^${n.toString(2).length - 1})`;

function attempt<T>(fn: () => T): { value: T | null; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    return { value: null, error: toolErrorText(e) };
  }
}

/** İkili gösterim: ağ bitleri vurgulu. */
function BinaryRow({ label, groups, prefix }: { label: string; groups: string[]; prefix: number }) {
  let remaining = prefix;
  return (
    <div className="flex items-start gap-2 border-b border-line px-2 py-1 last:border-b-0">
      <span className="w-32 shrink-0 text-xs text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-[11.5px] break-all text-fg-subtle">
        {groups.map((group, i) => {
          const net = Math.max(0, Math.min(group.length, remaining));
          remaining -= net;
          return (
            <span key={i}>
              {i > 0 && (groups.length === 4 ? '.' : ':')}
              <span className="font-semibold text-fg">{group.slice(0, net)}</span>
              {group.slice(net)}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function CidrDetails({ info }: { info: CidrInfo }) {
  const t = useT('toolsMisc');
  const v4 = info.version === 4;
  return (
    <>
      <ResultCard title={`IPv${info.version} · ${info.cidr}`}>
        <ValueRow label={t('cidr.address')} value={info.address} />
        {info.expanded && <ValueRow label={t('cidr.expanded')} value={info.expanded} />}
        {info.mappedIpv4 && <ValueRow label={t('cidr.mappedIpv4')} value={info.mappedIpv4} />}
        <ValueRow label={t('cidr.network')} value={info.network} />
        {info.broadcast && <ValueRow label={t('cidr.broadcast')} value={info.broadcast} />}
        <ValueRow label={t('cidr.firstUsable')} value={info.firstUsable} />
        <ValueRow label={t('cidr.lastUsable')} value={info.lastUsable} />
        <ValueRow label={t('cidr.prefix')} value={`/${info.prefix}`} />
        <ValueRow label={t('cidr.netmask')} value={info.netmask} />
        <ValueRow label={t('cidr.wildcard')} value={info.wildcard} />
        <ValueRow label={t('cidr.totalAddresses')} value={count(info.totalAddresses)} />
        <ValueRow label={t('cidr.usable')} value={count(info.usableHosts)} />
        {v4 && <ValueRow label={t('cidr.class')} value={info.addressClass ?? ''} />}
        <ValueRow
          label={t('cidr.type')}
          value={info.types
            .map((type) => [type.label, type.rfc && `(${type.rfc})`].filter(Boolean).join(' '))
            .join(' · ')}
        />
        <ValueRow label={t('cidr.reverseDns')} value={info.reverseDns} />
        <ValueRow label={t('cidr.reverseZone')} value={info.reverseZone} />
      </ResultCard>
      <ResultCard title={t('cidr.binary')}>
        <BinaryRow label={t('cidr.address')} groups={info.binary.address} prefix={info.prefix} />
        <BinaryRow label={t('cidr.mask')} groups={info.binary.netmask} prefix={info.prefix} />
      </ResultCard>
      <NoteList notes={info.notes} />
    </>
  );
}

function RangeResult({ result }: { result: Extract<IpInputResult, { kind: 'range' }> }) {
  const t = useT('toolsMisc');
  return (
    <ResultCard title={t('cidr.range', { start: result.start, end: result.end, count: count(result.total) })}>
      {result.cidrs.map((cidr, i) => (
        <ValueRow key={cidr} label={t('cidr.block', { n: i + 1 })} value={cidr} />
      ))}
    </ResultCard>
  );
}

function SplitTable({ split, v4 }: { split: SubnetSplit; v4: boolean }) {
  const t = useT('toolsMisc');
  return (
    <div className="overflow-auto rounded-md border border-line">
      <table className="w-full text-start font-mono text-[12px]">
        <caption className="px-2 py-1 text-start font-sans text-xs text-fg-muted">
          {t(split.truncated ? 'cidr.splitCaptionTruncated' : 'cidr.splitCaption', {
            total: count(split.total),
            size: count(split.size),
            prefix: split.prefix,
            limit: SPLIT_LIMIT,
          })}
        </caption>
        <thead className="font-sans text-xs text-fg-muted">
          <tr>
            <th className="px-2 py-1">CIDR</th>
            <th className="px-2 py-1">{t('cidr.first')}</th>
            <th className="px-2 py-1">{t('cidr.last')}</th>
            {v4 && <th className="px-2 py-1">{t('cidr.broadcastShort')}</th>}
          </tr>
        </thead>
        <tbody>
          {split.rows.map((row) => (
            <tr key={row.cidr} className="border-t border-line">
              <td className="px-2 py-0.5">{row.cidr}</td>
              <td className="px-2 py-0.5">{row.first}</td>
              <td className="px-2 py-0.5">{row.last}</td>
              {v4 && <td className="px-2 py-0.5">{row.broadcast ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CidrTool() {
  const t = useT('toolsMisc');
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [probe, setProbe] = useToolInput(TOOL, 'contains');
  const [splitMode, setSplitMode] = useToolInput(TOOL, 'splitMode', 'count');
  const [splitValue, setSplitValue] = useToolInput(TOOL, 'splitValue');

  const result = useMemo(() => (input.trim() ? attempt(() => analyzeIpInput(input)) : null), [input]);
  const cidr = result?.value?.kind === 'cidr' ? result.value.info : null;

  const contains = useMemo(
    () => (cidr && probe.trim() ? attempt(() => cidrContains(input, probe)) : null),
    [cidr, input, probe],
  );
  const split = useMemo(() => {
    if (!cidr || !splitValue.trim()) return null;
    const n = Number(splitValue.replace(/^\//, ''));
    return attempt(() =>
      splitCidr(input, splitMode === 'prefix' ? { prefix: n } : { count: n }, SPLIT_LIMIT),
    );
  }, [cidr, input, splitMode, splitValue]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ToolOptions>
        <div className="min-w-64 flex-1">
          <input
            className={unitInputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="192.168.1.10/24 · 10.0.0.0 255.255.255.0 · 10.0.0.5 - 10.0.0.20 · 2001:db8::/48"
            spellCheck={false}
            aria-label={t('cidr.inputLabel')}
          />
        </div>
      </ToolOptions>
      <ToolErrorMessage error={result?.error} />
      {result?.value?.kind === 'range' && <RangeResult result={result.value} />}
      {cidr && (
        <>
          <CidrDetails info={cidr} />
          <section className="flex flex-col gap-2" aria-label={t('cidr.containsCheck')}>
            <h3 className="text-xs font-semibold text-fg-muted">{t('cidr.containsTitle')}</h3>
            <input
              className={`${unitInputClass} max-w-md`}
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              placeholder={cidr.version === 4 ? '192.168.1.77' : '2001:db8::42'}
              spellCheck={false}
              aria-label={t('cidr.probe')}
            />
            <ToolErrorMessage error={contains?.error} />
            {contains?.value !== null && contains?.value !== undefined && (
              <p className={contains.value ? 'text-sm text-success' : 'text-sm text-danger'}>
                {t(contains.value ? 'cidr.inside' : 'cidr.outside', {
                  address: probe.trim(),
                  cidr: cidr.cidr,
                })}
              </p>
            )}
          </section>
          <section className="flex flex-col gap-2" aria-label={t('cidr.split')}>
            <h3 className="text-xs font-semibold text-fg-muted">{t('cidr.split')}</h3>
            <ToolOptions>
              <label className={toolLabelClass}>
                {t('cidr.splitting')}
                <select
                  className={toolSelectClass}
                  value={splitMode}
                  onChange={(e) => setSplitMode(e.target.value)}
                >
                  <option value="count">{t('cidr.byCount')}</option>
                  <option value="prefix">{t('cidr.byPrefix')}</option>
                </select>
              </label>
              <input
                className={`${unitInputClass} w-32`}
                value={splitValue}
                onChange={(e) => setSplitValue(e.target.value)}
                placeholder={
                  splitMode === 'prefix'
                    ? `/${Math.min(cidr.prefix + 2, cidr.version === 4 ? 32 : 128)}`
                    : '4'
                }
                spellCheck={false}
                aria-label={splitMode === 'prefix' ? t('cidr.newPrefix') : t('cidr.subnetCount')}
              />
            </ToolOptions>
            <ToolErrorMessage error={split?.error} />
            {split?.value && (
              <SplitTable split={split.value} v4={cidr.version === 4 && split.value.prefix < 31} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
