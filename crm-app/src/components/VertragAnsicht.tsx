/**
 * Der Vertrag, wie er gelesen wird – im Editor rechts als Vorschau und auf der
 * Unterschriftsseite des Kunden. Gleiche Absätze, gleiche Reihenfolge wie im PDF.
 */
import type { VertragsText } from '@/lib/vertrag';

const zeit = (iso?: string | null) => {
  if (!iso) return '';
  const x = new Date(iso);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}, ${p(x.getHours())}:${p(x.getMinutes())} Uhr`;
};

interface Unterschrift { png: string | null; name: string | null; wann: string | null }

export function VertragAnsicht({ text, links, rechts, kompakt = false }: {
  text: VertragsText; links?: Unterschrift; rechts?: Unterschrift; kompakt?: boolean;
}) {
  const Sig = ({ s, label }: { s?: Unterschrift; label: string }) => (
    <div>
      <div className="text-[10px] font-semibold tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="h-20 border-b border-foreground/60 flex items-end">
        {s?.png ? <img src={s.png} alt="Unterschrift" className="max-h-20 max-w-full object-contain" /> : null}
      </div>
      <div className="text-sm mt-1">{s?.name || (s?.png ? '' : <span className="text-muted-foreground">noch nicht unterschrieben</span>)}</div>
      {s?.wann && <div className="text-[10px] text-muted-foreground">elektronisch unterschrieben am {zeit(s.wann)}</div>}
    </div>
  );

  return (
    <article className={'bg-white text-[#111] ' + (kompakt ? 'text-[13px] leading-relaxed' : 'text-[15px] leading-relaxed')}>
      <h1 className={(kompakt ? 'text-lg' : 'text-2xl') + ' font-bold'}>{text.titel}</h1>
      <div className="text-xs text-muted-foreground mt-0.5 mb-5">Vertrag Nr. {text.nummer || '—'} · {text.datum}</div>

      <div className="grid grid-cols-2 gap-6 mb-5">
        {[['AUFTRAGNEHMER', text.anbieter], ['AUFTRAGGEBER', text.partner]].map(([label, zeilen]) => (
          <div key={label as string}>
            <div className="text-[10px] font-semibold tracking-wide text-muted-foreground mb-1">{label as string}</div>
            {(zeilen as string[]).map((z, i) => <div key={i} className={i === 0 ? 'font-semibold' : ''}>{z}</div>)}
          </div>
        ))}
      </div>
      <hr className="mb-5" />

      {text.abschnitte.map((a) => (
        <section key={a.heading} className="mb-4">
          <h2 className="font-bold mb-1">{a.heading}</h2>
          <p className="whitespace-pre-line">{a.body}</p>
        </section>
      ))}

      <hr className="my-5" />
      <div className="grid grid-cols-2 gap-6">
        <Sig s={links} label="AUFTRAGNEHMER" />
        <Sig s={rechts} label="AUFTRAGGEBER" />
      </div>
    </article>
  );
}
