import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, MicOff, Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface VoiceRecorderProps {
  initialText?: string;
  onSave: (text: string) => void;
}

export function VoiceRecorder({ initialText, onSave }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [summary, setSummary] = useState(initialText || '');
  const [hasNewSummary, setHasNewSummary] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/wav',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        await processAudio(blob, mediaRecorder.mimeType);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone error:', err);
      toast.error('Mikrofon konnte nicht gestartet werden. Bitte erlaube den Zugriff.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const processAudio = async (blob: Blob, mimeType: string) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const { data, error } = await supabase.functions.invoke('transcribe-summarize', {
        body: { audioBase64: base64, mimeType },
      });

      if (error) throw error;

      if (data?.summary) {
        const newText = summary ? `${summary}\n\n${data.summary}` : data.summary;
        setSummary(newText);
        setHasNewSummary(true);
        toast.success('Sprachaufnahme verarbeitet!');
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (err: any) {
      console.error('Processing error:', err);
      toast.error('Fehler bei der Verarbeitung der Aufnahme');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    onSave(summary);
    setHasNewSummary(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={isRecording ? 'destructive' : 'outline'}
          size="sm"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isRecording ? (
            <>
              <MicOff className="w-4 h-4 mr-1" />
              Stoppen
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 mr-1" />
              Aufnehmen
            </>
          )}
        </Button>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            Aufnahme läuft...
          </span>
        )}
        {isProcessing && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            KI verarbeitet...
          </span>
        )}
      </div>

      <Textarea
        value={summary}
        onChange={(e) => {
          setSummary(e.target.value);
          setHasNewSummary(true);
        }}
        placeholder="Hier erscheint die KI-Zusammenfassung des Kundenwunsches..."
        rows={4}
        className="resize-none"
      />

      {hasNewSummary && summary.trim() && (
        <Button type="button" size="sm" onClick={handleSave}>
          <Save className="w-4 h-4 mr-1" />
          Kundenwunsch speichern
        </Button>
      )}
    </div>
  );
}
