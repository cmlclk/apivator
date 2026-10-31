import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import {
  SQL_DIALECTS,
  SQL_MAX_ROWS,
  buildSqlInsert,
  sqlQuoteIdentifier,
  sqlQuoteText,
  type SqlInsertOptions,
} from './sqlInsert';
import type { CellValue } from '../tabular';

const ROWS = [
  ['id', 'ad', 'aktif'],
  ['1', "O'Brien", 'true'],
  ['2', 'Çağrı', 'false'],
];

const sql = (rows: CellValue[][], options: Partial<SqlInsertOptions> = {}) =>
  buildSqlInsert(rows, { table: 'users', dialect: 'postgres', ...options });

describe('lehçe kaçışları', () => {
  it('tanımlayıcı: iç tırnak ya da köşeli parantez ikilenir', () => {
    expect(sqlQuoteIdentifier('postgres', 'a"b')).toBe('"a""b"');
    expect(sqlQuoteIdentifier('sqlite', 'a"b')).toBe('"a""b"');
    expect(sqlQuoteIdentifier('oracle', 'a"b')).toBe('"a""b"');
    expect(sqlQuoteIdentifier('mysql', 'a`b')).toBe('`a``b`');
    expect(sqlQuoteIdentifier('sqlserver', 'a]b')).toBe('[a]]b]');
  });

  it('metin: tek tırnak ikilenir; MySQL ters böleyi de kaçışlar; SQL Server N önekli', () => {
    expect(sqlQuoteText('postgres', "it's")).toBe("'it''s'");
    expect(sqlQuoteText('postgres', 'a\\b')).toBe("'a\\b'");
    expect(sqlQuoteText('mysql', "a\\b'")).toBe("'a\\\\b'''");
    expect(sqlQuoteText('sqlserver', 'Çağrı')).toBe("N'Çağrı'");
    expect(sqlQuoteText('sqlite', "x'y")).toBe("'x''y'");
    expect(sqlQuoteText('oracle', "x'y")).toBe("'x''y'");
  });

  it('Oracle uzun metni TO_CLOB parçalarına böler', () => {
    const quoted = sqlQuoteText('oracle', 'a'.repeat(2500));
    expect(quoted.split(' || ')).toHaveLength(3);
    expect(quoted.startsWith("TO_CLOB('aaa")).toBe(true);
  });

  it('enjeksiyon içeriği literal içinde kalır', () => {
    const evil = "'); DROP TABLE x; --";
    for (const dialect of SQL_DIALECTS) {
      const { sql: out } = sql([['ad'], [evil]], { dialect });
      const literal = sqlQuoteText(dialect, evil);
      expect(out).toContain(`VALUES (${literal});`);
      expect(literal).toMatch(/^N?'''\); DROP TABLE x; --'$/);
    }
    // Başlıktaki içerik de tanımlayıcı içinde kalır.
    expect(sql([['a"); DROP TABLE x; --'], ['1']]).sql).toContain('("a""); DROP TABLE x; --")');
  });
});

describe('INSERT biçimi', () => {
  it('her lehçede satır başına INSERT', () => {
    expect(sql(ROWS).sql).toBe(
      [
        'INSERT INTO "users" ("id", "ad", "aktif") VALUES (1, \'O\'\'Brien\', TRUE);',
        'INSERT INTO "users" ("id", "ad", "aktif") VALUES (2, \'Çağrı\', FALSE);',
        '',
      ].join('\n'),
    );
    expect(sql(ROWS, { dialect: 'mysql' }).sql.split('\n')[0]).toBe(
      "INSERT INTO `users` (`id`, `ad`, `aktif`) VALUES (1, 'O''Brien', 1);",
    );
    expect(sql(ROWS, { dialect: 'sqlserver' }).sql.split('\n')[1]).toBe(
      "INSERT INTO [users] ([id], [ad], [aktif]) VALUES (2, N'Çağrı', 0);",
    );
    expect(sql(ROWS, { dialect: 'sqlite' }).sql.split('\n')[0]).toContain("VALUES (1, 'O''Brien', 1);");
    expect(sql(ROWS, { dialect: 'oracle' }).sql.split('\n')[0]).toContain('"users"');
  });

  it('şema önekli tablo adının her parçası ayrı tırnaklanır', () => {
    expect(sql(ROWS, { table: 'dbo.users', dialect: 'sqlserver' }).sql).toContain(
      'INSERT INTO [dbo].[users] ',
    );
    expect(sql(ROWS, { table: ' public . siparis ' }).sql).toContain('INSERT INTO "public"."siparis" ');
    expect(sql(ROWS, { table: 'a"b.c', dialect: 'oracle' }).sql).toContain('"a""b"."c"');
  });

  it('geçersiz tablo adı ToolError', () => {
    for (const table of ['', '  ', 'a..b', '.a', 'a.', 'a.b.c.d.e'])
      expect(() => sql(ROWS, { table })).toThrow(ToolError);
  });

  it('çok satırlı VALUES', () => {
    const { sql: out, rowsPerStatement } = sql(ROWS, { rowsPerStatement: 5 });
    expect(rowsPerStatement).toBe(5);
    expect(out).toBe(
      'INSERT INTO "users" ("id", "ad", "aktif") VALUES\n' +
        "  (1, 'O''Brien', TRUE),\n  (2, 'Çağrı', FALSE);\n",
    );
  });

  it('satırlar INSERT başına bölünür', () => {
    const rows = [['n'], ...Array.from({ length: 7 }, (_, i) => [String(i)])];
    const out = sql(rows, { rowsPerStatement: 3 }).sql;
    expect(out.match(/INSERT INTO/g)).toHaveLength(3);
    expect(out.trimEnd().split('\n').pop()).toBe('INSERT INTO "users" ("n") VALUES (6);');
  });

  it('SQL Server bir INSERT için en çok 1000 satır yazar', () => {
    const rows = [['n'], ...Array.from({ length: 2500 }, (_, i) => [String(i)])];
    const result = sql(rows, { dialect: 'sqlserver', rowsPerStatement: 5000 });
    expect(result.rowsPerStatement).toBe(1000);
    expect(result.sql.match(/INSERT INTO/g)).toHaveLength(3);
    expect(sql(rows, { rowsPerStatement: 5000 }).sql.match(/INSERT INTO/g)).toHaveLength(1);
  });

  it('Oracle çok satırlı INSERT ALL kullanır, 999 kolon sınırına uyar', () => {
    const out = sql(ROWS, { dialect: 'oracle', rowsPerStatement: 10 }).sql;
    expect(out).toBe(
      [
        'INSERT ALL',
        '  INTO "users" ("id", "ad", "aktif") VALUES (1, \'O\'\'Brien\', 1)',
        '  INTO "users" ("id", "ad", "aktif") VALUES (2, \'Çağrı\', 0)',
        'SELECT 1 FROM DUAL;',
        '',
      ].join('\n'),
    );
    // 500 kolonda 999 / 500 = 1 satır: INSERT ALL yerine düz INSERT.
    const wide = [
      Array.from({ length: 500 }, (_, i) => `c${i}`),
      Array.from({ length: 500 }, () => '1'),
      Array.from({ length: 500 }, () => '2'),
    ];
    const result = sql(wide, { dialect: 'oracle', rowsPerStatement: 10 });
    expect(result.rowsPerStatement).toBe(1);
    expect(result.sql).not.toContain('INSERT ALL');
  });
});

describe('başlık', () => {
  it('başlık yoksa column_N; ilk satır veri olur', () => {
    const out = sql([['a', 'b']], { header: false }).sql;
    expect(out).toBe('INSERT INTO "users" ("column_1", "column_2") VALUES (\'a\', \'b\');\n');
  });

  it('boş başlık column_N, yinelenenler _2 _3 (büyük/küçük harf duyarsız)', () => {
    const { columns } = sql([
      ['ad', 'Ad', '', 'ad', 'ad_2'],
      ['1', '2', '3', '4', '5'],
    ]);
    expect(columns.map((c) => c.name)).toEqual(['ad', 'Ad_2', 'column_3', 'ad_3', 'ad_2_2']);
  });

  it('başlıktan uzun satır fazla kolonlara column_N verir; kısa satır NULL', () => {
    const out = sql([['a'], ['1', '2'], ['3']]).sql;
    expect(out).toContain('("a", "column_2") VALUES (1, 2);');
    expect(out).toContain('VALUES (3, NULL);');
  });

  it('boş satırlar atlanır', () => {
    expect(sql([['a'], [''], ['1'], [null]]).rowCount).toBe(1);
  });
});

describe('tip çıkarımı', () => {
  const kinds = (rows: CellValue[][], options: Partial<SqlInsertOptions> = {}) =>
    sql(rows, options).columns.map((c) => c.kind);

  it('sayı, mantıksal ve metin', () => {
    expect(
      kinds([
        ['a', 'b', 'c', 'd'],
        ['1', 'true', 'x', '1.5'],
        ['-2', 'FALSE', '3', '2'],
      ]),
    ).toEqual(['integer', 'boolean', 'text', 'decimal']);
  });

  it('Excel sayı ve mantıksal hücreleri', () => {
    const out = sql([
      ['a', 'b', 'c'],
      [1, true, 2.5],
      [2, false, null],
    ]);
    expect(out.columns.map((c) => c.kind)).toEqual(['integer', 'boolean', 'decimal']);
    expect(out.sql).toContain('VALUES (1, TRUE, 2.5);');
    expect(out.sql).toContain('VALUES (2, FALSE, NULL);');
  });

  it('karışık sayı ve metin kolonu metin olur; sayı hücresi metne çevrilir', () => {
    const out = sql([['a'], [1], ['x']]);
    expect(out.columns[0]!.kind).toBe('text');
    expect(out.sql).toContain("VALUES ('1');");
  });

  it('başında sıfır olan sayılar metin kalır', () => {
    const out = sql([
      ['tel', 'kod'],
      ['05321234567', '00123'],
      ['05001112233', '7'],
    ]);
    expect(out.columns.map((c) => c.kind)).toEqual(['text', 'text']);
    expect(out.sql).toContain("VALUES ('05321234567', '00123');");
    // 0 ve 0.5 geçerli sayıdır.
    expect(kinds([['a'], ['0'], ['0.5']])).toEqual(['decimal']);
  });

  it('2^53 üstü tamsayıların rakamları aynen yazılır', () => {
    const out = sql([['id'], ['9007199254740993'], ['123456789012345678']]);
    expect(out.columns[0]!.kind).toBe('integer');
    expect(out.sql).toContain('VALUES (9007199254740993);');
    // 19+ hane BIGINT'e sığmaz: DECIMAL, yine rakamlar aynen.
    const huge = sql([['id'], ['12345678901234567890']], { dialect: 'mysql' });
    expect(huge.columns[0]).toMatchObject({ kind: 'decimal', sqlType: 'DECIMAL(20, 0)' });
    expect(huge.sql).toContain('VALUES (12345678901234567890);');
    // 38 haneyi aşan sayı metin olur.
    expect(kinds([['id'], ['1'.repeat(40)]])).toEqual(['text']);
  });

  it('üstel gösterimli Excel sayıları düz rakamla yazılır', () => {
    expect(sql([['a'], [1e21], [1]]).sql).toContain('VALUES (1000000000000000000000);');
    expect(sql([['a'], [1.5e-7]]).sql).toContain('VALUES (0.00000015);');
  });

  it('virgüllü ondalık: 1,5 → 1.5; 1.000 binlik olabileceğinden metin', () => {
    const out = sql(
      [
        ['a', 'b'],
        ['1,5', '1.000'],
        ['2', '2.500'],
      ],
      { decimal: ',' },
    );
    expect(out.columns.map((c) => c.kind)).toEqual(['decimal', 'text']);
    expect(out.sql).toContain("VALUES (1.5, '1.000');");
    // Noktalı ondalıkta virgüllü değer metin.
    expect(kinds([['a'], ['1,5']])).toEqual(['text']);
    expect(kinds([['a'], ['1.5']])).toEqual(['decimal']);
  });

  it('tip çıkarımı kapalıyken her şey metin', () => {
    const out = sql(
      [
        ['a', 'b'],
        ['1', 'true'],
        [2, true],
      ],
      { inferTypes: false },
    );
    expect(out.columns.map((c) => c.kind)).toEqual(['text', 'text']);
    expect(out.sql).toContain("VALUES ('1', 'true');");
    expect(out.sql).toContain("VALUES ('2', 'true');");
  });

  it('yalnız boş hücreli kolon metin, NULL', () => {
    const out = sql([
      ['a', 'b'],
      ['', '1'],
    ]);
    expect(out.columns[0]!.kind).toBe('text');
    expect(out.sql).toContain('VALUES (NULL, 1);');
  });
});

describe('boş hücre', () => {
  const rows = [
    ['ad', 'sayi', 'not'],
    ['', '', 'a'],
    ['x', '1', 'b'],
  ];

  it('varsayılan NULL', () => {
    expect(sql(rows).sql).toContain("VALUES (NULL, NULL, 'a');");
  });

  it("boş metin seçeneği yalnız metin kolonlarında '' yazar", () => {
    expect(sql(rows, { emptyAs: 'empty' }).sql).toContain("VALUES ('', NULL, 'a');");
    expect(sql(rows, { emptyAs: 'empty', dialect: 'sqlserver' }).sql).toContain("VALUES (N'', NULL, N'a');");
  });
});

describe('CREATE TABLE', () => {
  const rows = [
    ['id', 'tutar', 'aktif', 'ad', 'kod'],
    ['1', '1.25', 'true', 'x', '10000000000'],
    ['2', '10.5', 'false', 'y', '2'],
  ];
  const create = (options: Partial<SqlInsertOptions>) =>
    sql(rows, { ...options, createTable: true }).sql.split('\n\n')[0]!;

  it('PostgreSQL', () => {
    expect(create({ dialect: 'postgres' })).toBe(
      'CREATE TABLE "users" (\n  "id" integer,\n  "tutar" numeric(4, 2),\n  "aktif" boolean,\n  "ad" text,\n  "kod" bigint\n);',
    );
  });

  it('MySQL', () => {
    expect(create({ dialect: 'mysql' })).toBe(
      'CREATE TABLE `users` (\n  `id` INT,\n  `tutar` DECIMAL(4, 2),\n  `aktif` TINYINT(1),\n  `ad` TEXT,\n  `kod` BIGINT\n);',
    );
  });

  it('SQL Server', () => {
    expect(create({ dialect: 'sqlserver', table: 'dbo.t' })).toBe(
      'CREATE TABLE [dbo].[t] (\n  [id] INT,\n  [tutar] DECIMAL(4, 2),\n  [aktif] BIT,\n  [ad] NVARCHAR(MAX),\n  [kod] BIGINT\n);',
    );
  });

  it('SQLite', () => {
    expect(create({ dialect: 'sqlite' })).toBe(
      'CREATE TABLE "users" (\n  "id" INTEGER,\n  "tutar" NUMERIC,\n  "aktif" INTEGER,\n  "ad" TEXT,\n  "kod" INTEGER\n);',
    );
  });

  it('Oracle: kısa metin NVARCHAR2, uzun metin CLOB', () => {
    expect(create({ dialect: 'oracle' })).toBe(
      'CREATE TABLE "users" (\n  "id" NUMBER(10),\n  "tutar" NUMBER(4, 2),\n  "aktif" NUMBER(1),\n  "ad" NVARCHAR2(1),\n  "kod" NUMBER(19)\n);',
    );
    const long = sql([['a'], ['x'.repeat(1500)]], { dialect: 'oracle', createTable: true });
    expect(long.columns[0]!.sqlType).toBe('CLOB');
    expect(long.sql).toContain("TO_CLOB('xxx");
  });

  it('yalnız başlıkla CREATE TABLE yazılır; CREATE yoksa hata', () => {
    expect(sql([['a', 'b']], { createTable: true }).sql).toBe(
      'CREATE TABLE "users" (\n  "a" text,\n  "b" text\n);\n',
    );
    expect(() => sql([['a', 'b']])).toThrow(ToolError);
  });
});

describe('işlem bloğu', () => {
  const rows = [['a'], ['1']];

  it('lehçeye göre BEGIN … COMMIT', () => {
    expect(sql(rows, { transaction: true }).sql).toBe(
      'BEGIN;\nINSERT INTO "users" ("a") VALUES (1);\nCOMMIT;\n',
    );
    expect(sql(rows, { transaction: true, dialect: 'mysql' }).sql.startsWith('START TRANSACTION;\n')).toBe(
      true,
    );
    expect(
      sql(rows, { transaction: true, dialect: 'sqlserver' }).sql.startsWith('BEGIN TRANSACTION;\n'),
    ).toBe(true);
    expect(sql(rows, { transaction: true, dialect: 'sqlite' }).sql.startsWith('BEGIN;\n')).toBe(true);
  });

  it('Oracle açık BEGIN yazmaz, yalnız COMMIT', () => {
    expect(sql(rows, { transaction: true, dialect: 'oracle' }).sql).toBe(
      'INSERT INTO "users" ("a") VALUES (1);\nCOMMIT;\n',
    );
  });

  it('CREATE TABLE işlemin dışında', () => {
    const out = sql(rows, { transaction: true, createTable: true }).sql;
    expect(out.indexOf('CREATE TABLE')).toBeLessThan(out.indexOf('BEGIN;'));
  });
});

describe('sınırlar', () => {
  it('boş girdi', () => {
    expect(() => sql([])).toThrow(/veri yok/);
    expect(() => sql([[''], [null]])).toThrow(ToolError);
  });

  it('en çok satır', () => {
    const rows = Array.from({ length: SQL_MAX_ROWS + 2 }, () => ['1']);
    expect(() => sql(rows)).toThrow(/En fazla 200\.000 satır/);
  });

  it('çok kolon ve çok hücre', () => {
    expect(() => sql([Array.from({ length: 1001 }, (_, i) => `c${i}`), ['1']])).toThrow(/kolon/);
    const row = Array.from({ length: 100 }, () => '1');
    const rows = [row, ...Array.from({ length: 60_000 }, () => row)];
    expect(() => sql(rows)).toThrow(/hücre/);
  });
});
