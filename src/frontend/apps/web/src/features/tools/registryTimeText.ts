import { lazy } from 'react';
import type { ToolDef } from './registry';
import { tool } from './toolUtils';

/** Zaman, sayı ve birim; web ve ağ; metin araçları (7.7–7.9); sıra listede görünen sıradır. */
export const TIME_TEXT_TOOLS: ToolDef[] = [
  tool(
    'cron',
    'time',
    lazy(() => import('./tools/CronTool')),
  ),
  tool(
    'number-base',
    'time',
    lazy(() => import('./tools/NumberBaseTool')),
  ),
  tool(
    'byte-units',
    'time',
    lazy(() => import('./tools/ByteUnitsTool')),
  ),
  tool(
    'color',
    'time',
    lazy(() => import('./tools/ColorTool')),
  ),
  tool(
    'url-parser',
    'web',
    lazy(() => import('./tools/UrlParserTool')),
  ),
  tool(
    'http-reference',
    'web',
    lazy(() => import('./tools/HttpReferenceTool')),
  ),
  tool(
    'cookie',
    'web',
    lazy(() => import('./tools/CookieTool')),
  ),
  tool(
    'user-agent',
    'web',
    lazy(() => import('./tools/UserAgentTool')),
  ),
  tool(
    'cidr',
    'web',
    lazy(() => import('./tools/CidrTool')),
  ),
  tool(
    'case-convert',
    'text',
    lazy(() => import('./tools/CaseConvertTool')),
  ),
  tool(
    'slug',
    'text',
    lazy(() => import('./tools/SlugTool')),
  ),
  tool(
    'line-ops',
    'text',
    lazy(() => import('./tools/LineOpsTool')),
  ),
  tool(
    'text-stats',
    'text',
    lazy(() => import('./tools/TextStatsTool')),
  ),
  tool(
    'byte-view',
    'text',
    lazy(() => import('./tools/ByteViewTool')),
  ),
];
