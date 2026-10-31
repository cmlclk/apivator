import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { ExternalChange } from '@uiw/react-codemirror';
import { diffRange } from './diffRange';
import type { CollabSession, RemoteCursor } from './CollabSession';

/**
 * react-codemirror dışarıdan gelen değeri belgenin tamamını değiştirerek uygular; imleç sona atlar. Bu süzgeç
 * yerine yalnızca değişen aralığı yazar, böylece başkası aynı metinde yazarken imlecimiz yerinde kalır.
 */
export const minimalExternalChange: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.annotation(ExternalChange)) return tr;
  const old = tr.startState.doc;
  let whole: string | null = null;
  let count = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++;
    if (fromA === 0 && toA === old.length) whole = inserted.toString();
  });
  if (count !== 1 || whole === null) return tr;
  const { from, to, insert } = diffRange(old.toString(), whole);
  return [{ changes: { from, to, insert }, annotations: ExternalChange.of(true) }];
});

const setCursors = StateEffect.define<RemoteCursor[]>();

class CaretWidget extends WidgetType {
  constructor(
    private readonly name: string,
    private readonly color: string,
  ) {
    super();
  }

  override eq(other: CaretWidget) {
    return other.name === this.name && other.color === this.color;
  }

  override toDOM() {
    const caret = document.createElement('span');
    caret.className = 'cm-collab-caret';
    caret.style.borderLeftColor = this.color;
    const label = document.createElement('span');
    label.className = 'cm-collab-label';
    label.style.backgroundColor = this.color;
    label.textContent = this.name;
    caret.append(label);
    return caret;
  }

  override ignoreEvent() {
    return true;
  }
}

function build(cursors: RemoteCursor[], length: number): DecorationSet {
  const ranges = cursors.flatMap((c) => {
    const anchor = Math.min(c.anchor, length);
    const head = Math.min(c.head, length);
    const result = [Decoration.widget({ widget: new CaretWidget(c.name, c.color), side: 1 }).range(head)];
    if (anchor !== head) {
      result.push(
        Decoration.mark({ attributes: { style: `background-color: ${c.color}33` } }).range(
          Math.min(anchor, head),
          Math.max(anchor, head),
        ),
      );
    }
    return result;
  });
  return Decoration.set(ranges, true);
}

const cursorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCursors)) next = build(effect.value, tr.state.doc.length);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const cursorTheme = EditorView.baseTheme({
  '.cm-collab-caret': {
    position: 'relative',
    marginLeft: '-1px',
    marginRight: '-1px',
    borderLeft: '2px solid',
    pointerEvents: 'none',
  },
  '.cm-collab-label': {
    position: 'absolute',
    bottom: '100%',
    left: '-2px',
    padding: '0 4px',
    borderRadius: '3px 3px 3px 0',
    fontSize: '10px',
    lineHeight: '14px',
    color: 'white',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity 0.15s',
  },
  '.cm-collab-caret:hover .cm-collab-label': { opacity: '1' },
});

/**
 * Bu editörün Y.Text alanına (ör. "body.raw") ortak düzenleme imleçleri: diğer kişilerin imleç ve seçimi çizilir,
 * kendi imlecimiz ve odağımız onlara bildirilir.
 */
export function collabCursors(session: CollabSession, field: string): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private readonly off: () => void;

      constructor(private readonly view: EditorView) {
        const refresh = () => view.dispatch({ effects: setCursors.of(session.remoteCursors(field)) });
        this.off = session.onCursors(refresh);
        queueMicrotask(refresh);
      }

      update(update: { selectionSet: boolean; focusChanged: boolean }) {
        // Yerel yazım Y.Text'e eşlendikten sonra (aynı turun sonunda) göreli konum alınır.
        if (update.selectionSet || update.focusChanged) queueMicrotask(() => this.report());
      }

      private report() {
        const { anchor, head } = this.view.state.selection.main;
        session.setCursor(field, this.view.hasFocus ? { anchor, head } : null);
      }

      destroy() {
        this.off();
        session.setCursor(field, null);
      }
    },
  );
  return [cursorField, cursorTheme, plugin];
}
