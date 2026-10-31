import { lazy } from 'react';
import type { ToolDef } from './registry';
import { tool } from './toolUtils';

/** Biçimlendirme, sorgu, metin, güvenlik, üreteç ve zaman araçları; sıra listede görünen sıradır. */
export const FORMAT_MORE_TOOLS: ToolDef[] = [
  tool(
    'xml-format',
    'format',
    lazy(() => import('./tools/CodeFormatTool').then((m) => ({ default: m.XmlFormatTool }))),
  ),
  tool(
    'yaml-format',
    'format',
    lazy(() => import('./tools/CodeFormatTool').then((m) => ({ default: m.YamlFormatTool }))),
  ),
  tool(
    'sql-format',
    'format',
    lazy(() => import('./tools/CodeFormatTool').then((m) => ({ default: m.SqlFormatTool }))),
  ),
  tool(
    'graphql-format',
    'format',
    lazy(() => import('./tools/CodeFormatTool').then((m) => ({ default: m.GraphqlFormatTool }))),
  ),
  tool(
    'html-format',
    'format',
    lazy(() => import('./tools/CodeFormatTool').then((m) => ({ default: m.HtmlFormatTool }))),
  ),
  tool(
    'jsonpath',
    'format',
    lazy(() => import('./tools/JsonPathTool')),
  ),
  tool(
    'diff',
    'format',
    lazy(() => import('./tools/DiffTool')),
  ),
  tool(
    'python-indent',
    'format',
    lazy(() => import('./tools/PythonIndentTool')),
  ),
  tool(
    'regex',
    'text',
    lazy(() => import('./tools/RegexTool')),
  ),
  tool(
    'jwt',
    'security',
    lazy(() => import('./tools/JwtTool')),
  ),
  tool(
    'hash',
    'security',
    lazy(() => import('./tools/HashTool')),
  ),
  tool(
    'bcrypt',
    'security',
    lazy(() => import('./tools/BcryptTool')),
  ),
  tool(
    'aes',
    'security',
    lazy(() => import('./tools/AesTool')),
  ),
  tool(
    'key-pair',
    'security',
    lazy(() => import('./tools/KeyPairTool')),
  ),
  tool(
    'certificate',
    'security',
    lazy(() => import('./tools/CertificateTool')),
  ),
  tool(
    'basic-auth',
    'security',
    lazy(() => import('./tools/BasicAuthTool')),
  ),
  tool(
    'pkce',
    'security',
    lazy(() => import('./tools/PkceTool')),
  ),
  tool(
    'password',
    'security',
    lazy(() => import('./tools/PasswordTool')),
  ),
  tool(
    'uuid',
    'generate',
    lazy(() => import('./tools/UuidTool')),
  ),
  tool(
    'lorem',
    'generate',
    lazy(() => import('./tools/LoremTool')),
  ),
  tool(
    'random',
    'generate',
    lazy(() => import('./tools/RandomTool')),
  ),
  tool(
    'qr',
    'generate',
    lazy(() => import('./tools/QrTool')),
  ),
  tool(
    'fake-data',
    'generate',
    lazy(() => import('./tools/FakeDataTool')),
  ),
  tool(
    'timestamp',
    'time',
    lazy(() => import('./tools/TimestampTool')),
  ),
];
