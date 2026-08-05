import { useState } from 'react';
import { useOrderVolumes, OrderVolume } from '@/hooks/useOrderVolumes';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';

const MONTHS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

export default function OrderVolumePage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { orderVolumes, isLoading, yearlyTotal, addVolume, updateVolume, deleteVolume } = useOrderVolumes(selectedYear);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OrderVolume | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(1);
  const [formAmount, setFormAmount] = useState('');
  const [formSource, setFormSource] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const getVolumesForMonth = (month: number) => {
    return orderVolumes.filter(v => v.month === month);
  };

  const getMonthTotal = (month: number) => {
    return getVolumesForMonth(month).reduce((sum, v) => sum + Number(v.amount), 0);
  };

  const openAddDialog = (month: number) => {
    setEditingEntry(null);
    setSelectedMonth(month);
    setFormAmount('');
    setFormSource('');
    setFormDescription('');
    setDialogOpen(true);
  };

  const openEditDialog = (entry: OrderVolume) => {
    setEditingEntry(entry);
    setSelectedMonth(entry.month);
    setFormAmount(String(entry.amount));
    setFormSource(entry.source || '');
    setFormDescription(entry.description || '');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const amount = parseFloat(formAmount) || 0;
    
    try {
      if (editingEntry) {
        await updateVolume.mutateAsync({
          id: editingEntry.id,
          amount,
          source: formSource || undefined,
          description: formDescription || undefined,
        });
        toast.success('Eintrag aktualisiert');
      } else {
        await addVolume.mutateAsync({
          month: selectedMonth,
          amount,
          source: formSource || undefined,
          description: formDescription || undefined,
        });
        toast.success('Eintrag hinzugefügt');
      }
      setDialogOpen(false);
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(`Fehler beim Speichern: ${error?.message || 'Unbekannter Fehler'}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVolume.mutateAsync(id);
      toast.success('Eintrag gelöscht');
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error(`Fehler beim Löschen: ${error?.message || 'Unbekannter Fehler'}`);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onAddLead={() => {}} leadCount={0} wonCount={0} totalRevenue={0} />
      
      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Auftragsvolumen netto</CardTitle>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map(year => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Laden...</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Monat</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                      <TableHead>Quelle</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right w-24">Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {MONTHS.map((monthName, index) => {
                      const month = index + 1;
                      const volumes = getVolumesForMonth(month);
                      const monthTotal = getMonthTotal(month);
                      
                      if (volumes.length === 0) {
                        return (
                          <TableRow key={month}>
                            <TableCell className="font-medium">{monthName}</TableCell>
                            <TableCell className="text-right text-muted-foreground">-</TableCell>
                            <TableCell className="text-muted-foreground">-</TableCell>
                            <TableCell className="text-muted-foreground">-</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openAddDialog(month)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return volumes.map((volume, vIndex) => (
                        <TableRow key={volume.id}>
                          <TableCell className="font-medium">
                            {vIndex === 0 ? monthName : ''}
                            {vIndex === volumes.length - 1 && volumes.length > 1 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (Summe: {formatCurrency(monthTotal)})
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(Number(volume.amount))}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {volume.source || '-'}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {volume.description || '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {vIndex === 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openAddDialog(month)}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditDialog(volume)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => handleDelete(volume.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ));
                    })}
                  </TableBody>
                </Table>

                <div className="mt-6 flex justify-end border-t pt-4">
                  <div className="text-right">
                    <span className="text-muted-foreground">Gesamt {selectedYear}:</span>
                    <span className="ml-4 text-2xl font-bold text-primary">
                      {formatCurrency(yearlyTotal)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} - {MONTHS[selectedMonth - 1]} {selectedYear}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Auftragsvolumen netto (€)</Label>
              <Input
                type="number"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>Quelle / Herkunft</Label>
              <Input
                value={formSource}
                onChange={(e) => setFormSource(e.target.value)}
                placeholder="z.B. Bestandskunde, Neukunde, Empfehlung..."
              />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung (optional)</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Zusätzliche Notizen..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={addVolume.isPending || updateVolume.isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
