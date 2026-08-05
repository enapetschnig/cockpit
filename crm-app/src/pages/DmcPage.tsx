import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Zap, Plus, Mail, BarChart3, LogOut, Euro, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDmcContacts } from '@/hooks/useDmcContacts';
import { useAuth } from '@/hooks/useAuth';
import { DmcPipelineView } from '@/components/dmc/DmcPipelineView';
import { LetterLabelingMode } from '@/components/dmc/LetterLabelingMode';
import { DmcContactDetailDialog } from '@/components/dmc/DmcContactDetailDialog';
import { DmcAddContactDialog } from '@/components/dmc/DmcAddContactDialog';
import { DmcContact, DmcContactUpdate } from '@/types/dmc';
import { dmcInitialContacts } from '@/data/dmcInitialContacts';

export default function DmcPage() {
  const location = useLocation();
  const { signOut } = useAuth();
  const { contacts, isLoading, addContact, updateContact, deleteContact, markLetterSent, importContacts } = useDmcContacts();
  
  const [selectedContact, setSelectedContact] = useState<DmcContact | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleContactClick = (contact: DmcContact) => {
    setSelectedContact(contact);
    setDetailDialogOpen(true);
  };

  const handleContactUpdate = async (id: string, updates: DmcContactUpdate) => {
    const result = await updateContact(id, updates);
    if (result) {
      setSelectedContact(result);
    }
    return result;
  };

  const handleImportContacts = async () => {
    setIsImporting(true);
    await importContacts(dmcInitialContacts);
    setIsImporting(false);
  };

  const newCount = contacts.filter(c => c.stage === 'new').length;
  const sentCount = contacts.filter(c => c.stage === 'letter_sent').length;
  const wonCount = contacts.filter(c => c.stage === 'won').length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">epower CRM</h1>
                <p className="text-sm text-muted-foreground">DMC-Strategie</p>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1 ml-4">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  Pipeline
                </Button>
              </Link>
              <Link to="/kennzahlen">
                <Button variant="ghost" size="sm" className="gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Kennzahlen
                </Button>
              </Link>
              <Link to="/auftragsvolumen">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Euro className="w-4 h-4" />
                  Auftragsvolumen
                </Button>
              </Link>
              <Link to="/dmc">
                <Button variant="secondary" size="sm" className="gap-2">
                  <Mail className="w-4 h-4" />
                  DMC
                </Button>
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-6 text-sm">
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">{contacts.length}</p>
                <p className="text-muted-foreground">Kontakte</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-500">{sentCount}</p>
                <p className="text-muted-foreground">Briefe</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold text-success">{wonCount}</p>
                <p className="text-muted-foreground">Gewonnen</p>
              </div>
            </div>

            <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Neuer Kontakt
            </Button>

            <Button variant="ghost" size="icon" onClick={signOut} title="Ausloggen">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-muted-foreground">Laden...</div>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Mail className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-2">Keine Kontakte vorhanden</h2>
            <p className="text-muted-foreground mb-6">
              Importiere die vorbereiteten Kontakte oder füge manuell neue hinzu.
            </p>
            <div className="flex gap-4">
              <Button onClick={handleImportContacts} disabled={isImporting} className="gap-2">
                <Download className="w-4 h-4" />
                {isImporting ? 'Importiere...' : '48 Kontakte importieren'}
              </Button>
              <Button variant="outline" onClick={() => setAddDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Manuell hinzufügen
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="pipeline" className="space-y-6">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                <TabsTrigger value="labeling" className="gap-2">
                  <Mail className="w-4 h-4" />
                  Beschriften ({newCount})
                </TabsTrigger>
              </TabsList>

              {contacts.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleImportContacts} 
                  disabled={isImporting}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Weitere importieren
                </Button>
              )}
            </div>

            <TabsContent value="pipeline">
              <DmcPipelineView 
                contacts={contacts} 
                onContactClick={handleContactClick}
              />
            </TabsContent>

            <TabsContent value="labeling">
              <LetterLabelingMode 
                contacts={contacts}
                onMarkLetterSent={markLetterSent}
              />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Dialogs */}
      <DmcContactDetailDialog
        contact={selectedContact}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        onUpdate={handleContactUpdate}
        onDelete={deleteContact}
      />

      <DmcAddContactDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={addContact}
      />
    </div>
  );
}
