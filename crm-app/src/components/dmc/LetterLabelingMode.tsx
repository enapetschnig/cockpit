import { useState } from 'react';
import { DmcContact } from '@/types/dmc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Check, ChevronRight, Mail } from 'lucide-react';

interface LetterLabelingModeProps {
  contacts: DmcContact[];
  onMarkLetterSent: (id: string) => Promise<any>;
}

export function LetterLabelingMode({ contacts, onMarkLetterSent }: LetterLabelingModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMarking, setIsMarking] = useState(false);

  // Filter only "new" contacts (no letter sent yet)
  const newContacts = contacts.filter(c => c.stage === 'new');
  const totalNew = newContacts.length;
  const sentCount = contacts.filter(c => c.stage !== 'new').length;

  const currentContact = newContacts[currentIndex];

  const handleMarkSent = async () => {
    if (!currentContact) return;
    setIsMarking(true);
    await onMarkLetterSent(currentContact.id);
    setIsMarking(false);
    // Move to next automatically (list will refresh, so index stays same)
  };

  const handleSkip = () => {
    if (currentIndex < totalNew - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(0); // Loop back to start
    }
  };

  if (totalNew === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Alle Briefe fertig!</h2>
        <p className="text-muted-foreground">
          Du hast bereits {sentCount} Briefe verschickt.
        </p>
      </div>
    );
  }

  const progressPercent = (sentCount / (sentCount + totalNew)) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Fortschritt: {sentCount} von {sentCount + totalNew} Briefe verschickt
          </span>
          <span className="text-sm font-medium text-foreground">
            {Math.round(progressPercent)}%
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Contact Card */}
      <Card className="mb-6">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 mb-6 text-muted-foreground">
            <Mail className="w-5 h-5" />
            <span className="text-sm">Kontakt {currentIndex + 1} von {totalNew}</span>
          </div>

          <div className="space-y-4 text-center">
            {/* CEO Name - Large */}
            <div className="text-3xl font-bold text-foreground">
              {currentContact.ceo_name || currentContact.company_name}
            </div>
            
            {/* Company Name */}
            {currentContact.ceo_name && (
              <div className="text-xl text-muted-foreground">
                {currentContact.company_name}
              </div>
            )}

            {/* Address */}
            <div className="text-lg text-foreground pt-4 border-t border-border mt-6">
              <div>{currentContact.street}</div>
              <div>{currentContact.postal_code} {currentContact.city}</div>
            </div>

            {/* Region Badge */}
            {currentContact.region && (
              <div className="text-sm text-muted-foreground">
                {currentContact.region}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-4">
        <Button 
          onClick={handleMarkSent}
          disabled={isMarking}
          className="flex-1 gap-2"
          size="lg"
        >
          <Check className="w-5 h-5" />
          Brief verschickt
        </Button>
        <Button 
          variant="outline"
          onClick={handleSkip}
          className="flex-1 gap-2"
          size="lg"
        >
          Überspringen
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
