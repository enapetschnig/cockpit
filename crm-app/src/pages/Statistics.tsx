import { useMemo, useState } from 'react';
import { Lead } from '@/types/lead';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Phone, PhoneOff, PhoneIncoming, Calendar, TrendingUp, Users, Target, Euro } from 'lucide-react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfDay, endOfDay, isWithinInterval, subWeeks } from 'date-fns';
import { de } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface StatisticsProps {
  leads: Lead[];
}

type TimeFilter = 'today' | 'week' | 'month' | 'year' | 'all';

export function Statistics({ leads }: StatisticsProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const getDateRange = (filter: TimeFilter) => {
    const now = new Date();
    switch (filter) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
      case 'all':
      default:
        return null;
    }
  };

  const filteredLeads = useMemo(() => {
    const range = getDateRange(timeFilter);
    if (!range) return leads;

    return leads.filter((lead) => {
      const createdAt = new Date(lead.createdAt);
      return isWithinInterval(createdAt, range);
    });
  }, [leads, timeFilter]);

  const stats = useMemo(() => {
    const range = getDateRange(timeFilter);

    // Alle Kontaktlogs sammeln (gefiltert nach Zeitraum)
    const allContactLogs = filteredLeads.flatMap((lead) =>
      lead.contactLogs
        .filter((log) => {
          if (!range) return true;
          const logDate = new Date(log.date);
          return isWithinInterval(logDate, range);
        })
        .map((log) => ({ ...log, leadId: lead.id }))
    );

    // Anrufe zählen
    const callLogs = allContactLogs.filter((log) => log.type === 'call');
    const totalCalls = callLogs.length;
    const reachedCalls = callLogs.filter((log) => log.reachedCustomer).length;
    const notReachedCalls = totalCalls - reachedCalls;
    const reachRate = totalCalls > 0 ? Math.round((reachedCalls / totalCalls) * 100) : 0;

    // Meetings
    const meetingLogs = allContactLogs.filter((log) => log.type === 'meeting');
    const totalMeetings = meetingLogs.length;

    // Leads mit Termin
    const leadsWithMeeting = filteredLeads.filter(
      (l) => l.stage === 'meeting_scheduled' || l.stage === 'meeting_done' || l.stage === 'won'
    ).length;

    // Termine erschienen
    const leadsAppeared = filteredLeads.filter((l) => l.meetingAppeared).length;
    const appearanceRate = leadsWithMeeting > 0 ? Math.round((leadsAppeared / leadsWithMeeting) * 100) : 0;

    // Conversion Rate (Leads → Won)
    const wonLeads = filteredLeads.filter((l) => l.stage === 'won').length;
    const totalLeads = filteredLeads.length;
    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    // Umsatz
    const totalRevenue = filteredLeads
      .filter((l) => l.stage === 'won')
      .reduce((sum, l) => sum + (l.saleAmount || 0), 0);

    // Durchschnittlicher Verkaufswert
    const avgDealValue = wonLeads > 0 ? Math.round(totalRevenue / wonLeads) : 0;

    // Diese Woche (nur für Vergleich bei "all" Filter)
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    
    const allCallLogs = leads.flatMap((lead) =>
      lead.contactLogs.filter((log) => log.type === 'call')
    );
    
    const callsThisWeek = allCallLogs.filter((log) => {
      const logDate = new Date(log.date);
      return isWithinInterval(logDate, { start: weekStart, end: weekEnd });
    }).length;

    // Letzte Woche zum Vergleich
    const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    
    const callsLastWeek = allCallLogs.filter((log) => {
      const logDate = new Date(log.date);
      return isWithinInterval(logDate, { start: lastWeekStart, end: lastWeekEnd });
    }).length;

    // Leads nach Status
    const leadsByStage = {
      new: filteredLeads.filter((l) => l.stage === 'new').length,
      contacted: filteredLeads.filter((l) => l.stage === 'contacted').length,
      follow_up: filteredLeads.filter((l) => l.stage === 'follow_up').length,
      qualified: filteredLeads.filter((l) => l.stage === 'qualified').length,
      unqualified: filteredLeads.filter((l) => l.stage === 'unqualified').length,
      meeting_scheduled: filteredLeads.filter((l) => l.stage === 'meeting_scheduled').length,
      meeting_done: filteredLeads.filter((l) => l.stage === 'meeting_done').length,
      won: filteredLeads.filter((l) => l.stage === 'won').length,
      lost: filteredLeads.filter((l) => l.stage === 'lost').length,
    };

    return {
      totalCalls,
      reachedCalls,
      notReachedCalls,
      reachRate,
      totalMeetings,
      leadsWithMeeting,
      leadsAppeared,
      appearanceRate,
      conversionRate,
      wonLeads,
      totalLeads,
      totalRevenue,
      avgDealValue,
      callsThisWeek,
      callsLastWeek,
      leadsByStage,
    };
  }, [filteredLeads, leads, timeFilter]);

  const getFilterLabel = (filter: TimeFilter) => {
    switch (filter) {
      case 'today': return 'Heute';
      case 'week': return 'Diese Woche';
      case 'month': return 'Dieser Monat';
      case 'year': return 'Dieses Jahr';
      case 'all': return 'Alle Zeit';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-1">Kennzahlen</h2>
          <p className="text-muted-foreground">Übersicht über deine Verkaufsaktivitäten</p>
        </div>
        <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Zeitraum wählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Heute</SelectItem>
            <SelectItem value="week">Diese Woche</SelectItem>
            <SelectItem value="month">Dieser Monat</SelectItem>
            <SelectItem value="year">Dieses Jahr</SelectItem>
            <SelectItem value="all">Alle Zeit</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Hauptkennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Anrufe gesamt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalCalls}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Diese Woche: {stats.callsThisWeek}
              {stats.callsLastWeek > 0 && (
                <span className={stats.callsThisWeek >= stats.callsLastWeek ? 'text-success' : 'text-destructive'}>
                  {' '}({stats.callsThisWeek >= stats.callsLastWeek ? '+' : ''}{stats.callsThisWeek - stats.callsLastWeek} vs. letzte Woche)
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PhoneIncoming className="w-4 h-4" />
              Erreichbarkeit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.reachRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.reachedCalls} erreicht / {stats.notReachedCalls} nicht erreicht
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="w-4 h-4" />
              Conversion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-success">{stats.conversionRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.wonLeads} von {stats.totalLeads} Leads gewonnen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Euro className="w-4 h-4" />
              Umsatz
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.totalRevenue.toLocaleString('de-DE')} €</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ø {stats.avgDealValue.toLocaleString('de-DE')} € pro Deal
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Termine */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Termine vereinbart
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.leadsWithMeeting}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Erschienen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.leadsAppeared}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.appearanceRate}% Erscheinungsrate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Abschlussquote
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-success">
              {stats.leadsAppeared > 0 ? Math.round((stats.wonLeads / stats.leadsAppeared) * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Von erschienenen Terminen
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Übersicht */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pipeline Übersicht</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            <div className="text-center p-3 bg-blue-500/10 rounded-lg">
              <p className="text-2xl font-bold text-blue-500">{stats.leadsByStage.new}</p>
              <p className="text-xs text-muted-foreground">Neu</p>
            </div>
            <div className="text-center p-3 bg-amber-500/10 rounded-lg">
              <p className="text-2xl font-bold text-amber-500">{stats.leadsByStage.contacted}</p>
              <p className="text-xs text-muted-foreground">Kontaktiert</p>
            </div>
            <div className="text-center p-3 bg-orange-500/10 rounded-lg">
              <p className="text-2xl font-bold text-orange-500">{stats.leadsByStage.follow_up}</p>
              <p className="text-xs text-muted-foreground">Follow-Up</p>
            </div>
            <div className="text-center p-3 bg-cyan-500/10 rounded-lg">
              <p className="text-2xl font-bold text-cyan-500">{stats.leadsByStage.meeting_scheduled}</p>
              <p className="text-xs text-muted-foreground">Termin</p>
            </div>
            <div className="text-center p-3 bg-emerald-500/10 rounded-lg">
              <p className="text-2xl font-bold text-emerald-500">{stats.leadsByStage.won}</p>
              <p className="text-xs text-muted-foreground">Gewonnen</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
