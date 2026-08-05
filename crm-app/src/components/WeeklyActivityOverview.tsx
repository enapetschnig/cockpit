import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Phone, TrendingUp, TrendingDown, Minus, Pencil, Check, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { startOfWeek, endOfWeek, subWeeks, format, parseISO, isWithinInterval, eachDayOfInterval, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Lead } from '@/types/lead';
import { useDailyActivity } from '@/hooks/useDailyActivity';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface WeeklyActivityOverviewProps {
  leads: Lead[];
}

interface DayData {
  label: string;
  date: string;
  count: number;
  isManual: boolean;
}

function getDayData(leads: Lead[], daysBack: number, getCountForDate: (date: string) => number | null): DayData[] {
  const now = new Date();
  const days: DayData[] = [];

  for (let i = daysBack - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dateStr = format(day, 'yyyy-MM-dd');

    const manualCount = getCountForDate(dateStr);

    if (manualCount !== null) {
      days.push({
        label: format(day, 'EE dd.MM', { locale: de }),
        date: dateStr,
        count: manualCount,
        isManual: true,
      });
    } else {
      let count = 0;
      for (const lead of leads) {
        for (const log of lead.contactLogs) {
          const logDate = parseISO(log.date);
          if (isSameDay(logDate, day)) {
            count++;
          }
        }
      }
      days.push({
        label: format(day, 'EE dd.MM', { locale: de }),
        date: dateStr,
        count,
        isManual: false,
      });
    }
  }

  return days;
}

function getWeeklyTotals(dayData: DayData[]) {
  const now = new Date();
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
  const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });

  let thisWeek = 0;
  let lastWeek = 0;

  for (const d of dayData) {
    const date = parseISO(d.date);
    if (date >= thisWeekStart) thisWeek += d.count;
    if (isWithinInterval(date, { start: lastWeekStart, end: lastWeekEnd })) lastWeek += d.count;
  }

  return { thisWeek, lastWeek };
}

export function WeeklyActivityOverview({ leads }: WeeklyActivityOverviewProps) {
  const { getCountForDate, upsertActivity } = useDailyActivity();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const dayData = useMemo(() => getDayData(leads, 28, getCountForDate), [leads, getCountForDate]);
  const { thisWeek, lastWeek } = useMemo(() => getWeeklyTotals(dayData), [dayData]);
  const diff = thisWeek - lastWeek;

  const TrendIcon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const trendColor = diff > 0 ? 'text-success' : diff < 0 ? 'text-destructive' : 'text-muted-foreground';

  const handleBarClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const clicked = data.activePayload[0].payload as DayData;
      setEditingDate(clicked.date);
      setEditValue(String(clicked.count));
    }
  };

  const handleSave = async () => {
    if (editingDate === null) return;
    const val = parseInt(editValue, 10);
    if (isNaN(val) || val < 0) return;
    await upsertActivity(editingDate, val);
    setEditingDate(null);
    setEditValue('');
  };

  const handleCancel = () => {
    setEditingDate(null);
    setEditValue('');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          {/* Stats */}
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Phone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{thisWeek}</p>
                <p className="text-xs text-muted-foreground">Diese Woche</p>
              </div>
            </div>

            <div className="w-px h-10 bg-border" />

            <div>
              <p className="text-2xl font-bold text-foreground">{lastWeek}</p>
              <p className="text-xs text-muted-foreground">Letzte Woche</p>
            </div>

            <div className="w-px h-10 bg-border" />

            <div className="flex items-center gap-1.5">
              <TrendIcon className={`w-5 h-5 ${trendColor}`} />
              <span className={`text-sm font-semibold ${trendColor}`}>
                {diff > 0 ? '+' : ''}{diff}
              </span>
            </div>
          </div>

          {/* Edit inline */}
          {editingDate && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted-foreground">
                {format(parseISO(editingDate), 'dd.MM.yyyy', { locale: de })}:
              </span>
              <Input
                type="number"
                min={0}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-20 h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') handleCancel();
                }}
              />
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleSave}>
                <Check className="w-4 h-4 text-success" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleCancel}>
                <X className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          )}

          {!editingDate && (
            <p className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
              <Pencil className="w-3 h-3" /> Klick auf Balken zum Bearbeiten
            </p>
          )}
        </div>

        {/* Chart */}
        <div className="h-28 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dayData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} onClick={handleBarClick}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="label" 
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} 
                axisLine={false} 
                tickLine={false}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={40}
              />
              <YAxis hide allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number, _name: string, props: any) => {
                  const item = props.payload as DayData;
                  return [`${value} Kontakte${item.isManual ? ' (manuell)' : ''}`, ''];
                }}
                labelFormatter={(label) => label}
              />
              <Bar 
                dataKey="count" 
                radius={[3, 3, 0, 0]} 
                maxBarSize={20}
                cursor="pointer"
              >
                {dayData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.isManual ? 'hsl(var(--accent))' : 'hsl(var(--primary))'} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}
