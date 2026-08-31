import { Offer } from '@/hooks/useOffers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tag, X, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

interface OfferPickerProps {
  offers: Offer[];
  selectedOfferId?: string | null;
  onChange: (offerId: string | null) => void;
  size?: 'sm' | 'md';
  stopPropagation?: boolean;
}

export function OfferPicker({
  offers,
  selectedOfferId,
  onChange,
  size = 'sm',
  stopPropagation = true,
}: OfferPickerProps) {
  const selected = offers.find((o) => o.id === selectedOfferId) || null;

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  const baseClasses =
    size === 'sm'
      ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all'
      : 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border transition-all';

  return (
    <div onClick={handleClick}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${baseClasses} ${
              selected
                ? 'border-transparent text-white hover:opacity-90'
                : 'border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 bg-transparent'
            }`}
            style={selected ? { backgroundColor: selected.color } : undefined}
            title={selected ? `Etikett: ${selected.name}` : 'Etikett wählen'}
          >
            <Tag className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            <span className="truncate max-w-[120px]">
              {selected ? selected.name : 'Etikett'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={handleClick}>
          {offers.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              Noch keine Etiketten angelegt
            </div>
          )}
          {offers.map((offer) => (
            <DropdownMenuItem
              key={offer.id}
              onClick={() => onChange(offer.id)}
              className="flex items-center gap-2"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: offer.color }}
              />
              <span className="flex-1">{offer.name}</span>
              {selectedOfferId === offer.id && (
                <span className="text-xs text-muted-foreground">✓</span>
              )}
            </DropdownMenuItem>
          ))}
          {selected && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onChange(null)}
                className="text-muted-foreground"
              >
                <X className="w-3.5 h-3.5 mr-2" />
                Auswahl entfernen
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/angebote" className="flex items-center text-xs">
              <Plus className="w-3.5 h-3.5 mr-2" />
              Etiketten verwalten
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
