import { lazy } from 'react';
import type { ToolDef } from './registry';
import { tool } from './toolUtils';

/** Kodlama, JSON biçimlendirme ve veri dönüştürme araçları; sıra listede görünen sıradır. */
export const ENCODE_CONVERT_TOOLS: ToolDef[] = [
  tool(
    'base64',
    'encoding',
    lazy(() => import('./tools/Base64Tool')),
  ),
  tool(
    'url',
    'encoding',
    lazy(() => import('./tools/UrlTool')),
  ),
  tool(
    'html-entity',
    'encoding',
    lazy(() => import('./tools/HtmlEntityTool')),
  ),
  tool(
    'unicode',
    'encoding',
    lazy(() => import('./tools/UnicodeTool')),
  ),
  tool(
    'hex',
    'encoding',
    lazy(() => import('./tools/HexTool')),
  ),
  tool(
    'base32',
    'encoding',
    lazy(() => import('./tools/Base32Tool')),
  ),
  tool(
    'string-escape',
    'encoding',
    lazy(() => import('./tools/StringEscapeTool')),
  ),
  tool(
    'compress',
    'encoding',
    lazy(() => import('./tools/CompressTool')),
  ),
  tool(
    'json-format',
    'format',
    lazy(() => import('./tools/JsonFormatTool')),
  ),
  tool(
    'json-convert',
    'convert',
    lazy(() => import('./tools/JsonConvertTool')),
  ),
  tool(
    'json-schema',
    'convert',
    lazy(() => import('./tools/JsonSchemaTool')),
  ),
  tool(
    'curl-code',
    'convert',
    lazy(() => import('./tools/CurlCodeTool')),
  ),
  tool(
    'har',
    'convert',
    lazy(() => import('./tools/HarTool')),
  ),
  tool(
    'sql-insert',
    'convert',
    lazy(() => import('./tools/SqlInsertTool')),
  ),
  tool(
    'json-model',
    'convert',
    lazy(() => import('./tools/ModelTool')),
  ),
];
