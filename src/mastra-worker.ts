import { createClient } from '@supabase/supabase-js';
import { mastra, messageProcessingAgent } from './mastra-config';
import { formCreationWorkflow, calendarQueryWorkflow, conversationWorkflow } from './mastra-workflows';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ConversationMessage {
  id: string;
  content: string;
  direction: 'incoming' | 'outgoing';
  phone_number: string;
  profile_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  parent_id?: string;
}

export class MastraMessageProcessor {
  private isProcessing = false;

  async start() {
    console.log('🤖 Mastra Message Processor starting...');
    
    // Set up real-time subscription for new messages
    const subscription = supabase
      .channel('conversation_jobs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_jobs'
      }, (payload) => {
        console.log('📨 New job received:', payload.new);
        this.processJob(payload.new as any);
      })
      .subscribe();

    // Process any existing pending jobs
    await this.processPendingJobs();
    
    console.log('✅ Mastra Message Processor ready');
  }

  private async processPendingJobs() {
    const { data: jobs, error } = await supabase
      .from('conversation_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Error fetching pending jobs:', error);
      return;
    }

    for (const job of jobs || []) {
      await this.processJob(job);
    }
  }

  private async processJob(job: any) {
    if (this.isProcessing) {
      console.log('⏳ Already processing, queuing job:', job.id);
      return;
    }

    this.isProcessing = true;

    try {
      // Update job status
      await supabase
        .from('conversation_jobs')
        .update({ status: 'processing' })
        .eq('id', job.id);

      // Get the message
      const { data: message, error: messageError } = await supabase
        .from('conversation_messages')
        .select('*')
        .eq('id', job.message_id)
        .single();

      if (messageError || !message) {
        throw new Error(`Failed to get message: ${messageError?.message}`);
      }

      await this.processMessageWithMastra(message);

      // Mark job as completed
      await supabase
        .from('conversation_jobs')
        .update({ status: 'completed' })
        .eq('id', job.id);

    } catch (error) {
      console.error('❌ Error processing job:', error);
      
      await supabase
        .from('conversation_jobs')
        .update({ 
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', job.id);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processMessageWithMastra(message: ConversationMessage) {
    console.log(`🔄 Processing message with Mastra: ${message.content}`);

    try {
      // Get conversation history for context
      const { data: history } = await supabase
        .from('conversation_messages')
        .select('content, direction')
        .eq('phone_number', message.phone_number)
        .eq('profile_id', message.profile_id)
        .order('created_at', { ascending: true })
        .limit(10);

      const conversationContext = history?.map(msg => ({
        role: msg.direction === 'incoming' ? 'user' : 'assistant' as const,
        content: msg.content
      })) || [];

      // Use Mastra's intelligent conversation workflow
      const result = await conversationWorkflow.trigger({
        userPhone: message.phone_number,
        message: message.content,
        profileId: message.profile_id,
        conversationContext
      });

      console.log('✅ Mastra workflow completed:', result);

      // Update message status
      await supabase
        .from('conversation_messages')
        .update({ status: 'completed' })
        .eq('id', message.id);

    } catch (error) {
      console.error('❌ Error in Mastra processing:', error);
      
      // Update message status
      await supabase
        .from('conversation_messages')
        .update({ status: 'failed' })
        .eq('id', message.id);

      // Send error response to user
      await this.sendErrorResponse(message);
    }
  }

  private async sendErrorResponse(message: ConversationMessage) {
    const errorMessage = "I'm sorry, I encountered an error processing your message. Please try again later.";
    
    await supabase
      .from('conversation_messages')
      .insert({
        content: errorMessage,
        direction: 'outgoing',
        phone_number: message.phone_number,
        profile_id: message.profile_id,
        status: 'completed',
        parent_id: message.id
      });
  }

  // Method to manually trigger specific workflows for testing
  async triggerFormWorkflow(userPhone: string, profileId: string, formData: any) {
    return await formCreationWorkflow.trigger({
      userPhone,
      formRequest: {
        ...formData,
        profileId
      }
    });
  }

  async triggerCalendarWorkflow(userPhone: string, profileId: string, query: string, dateRange?: any) {
    return await calendarQueryWorkflow.trigger({
      userPhone,
      query,
      profileId,
      dateRange
    });
  }
}

// Initialize and start the processor
if (require.main === module) {
  const processor = new MastraMessageProcessor();
  processor.start().catch(console.error);
}

export default MastraMessageProcessor;