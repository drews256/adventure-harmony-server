import { MCPTool } from './goguide-api';

export interface SMSToolArgs {
  to: string;
  message: string;
  fromName?: string;
}

/**
 * SMS tool for sending text messages (currently logs to console for development)
 */
export class SMSTool {
  private supabase;
  
  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /**
   * Send SMS message (currently a development implementation)
   */
  async sendSMS(args: SMSToolArgs): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Validate phone number format - require minimum 10 digits for proper phone numbers
      const cleanPhone = args.to.replace(/[\s\-\(\)]/g, '');
      const phoneRegex = /^\+?[1-9]\d{9,14}$/; // 10-15 digits total, no leading zeros
      if (!phoneRegex.test(cleanPhone)) {
        throw new Error('Invalid phone number format. Phone numbers must be 10-15 digits and cannot start with 0.');
      }
      
      // For development: Log the SMS instead of sending
      console.log('=== SMS MESSAGE ===');
      console.log(`To: ${cleanPhone}`);
      console.log(`From: ${args.fromName || 'Adventure Harmony'}`);
      console.log(`Message: ${args.message}`);
      console.log('==================');

      // TODO: Implement actual SMS sending using Twilio or similar service
      // Example Twilio implementation:
      /*
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      
      const message = await client.messages.create({
        body: args.message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: cleanPhone
      });
      
      return {
        success: true,
        messageId: message.sid
      };
      */

      // Development response
      const messageId = `dev_sms_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      
      // Store SMS log in database for tracking
      try {
        await this.supabase
          .from('sms_logs')
          .insert({
            id: messageId,
            to_phone: cleanPhone,
            message: args.message,
            from_name: args.fromName || 'Adventure Harmony',
            status: 'development_log',
            sent_at: new Date().toISOString()
          });
      } catch (logError) {
        // If SMS logs table doesn't exist, continue anyway
        console.warn('SMS logs table may not exist:', logError);
      }

      return {
        success: true,
        messageId
      };

    } catch (error) {
      console.error('SMS sending failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send form link via SMS
   */
  async sendFormLink(
    phoneNumber: string, 
    formUrl: string, 
    formTitle: string,
    businessName: string = 'Adventure Harmony'
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const message = `Hi! ${businessName} has sent you a form to fill out: "${formTitle}". Please click here to complete it: ${formUrl}`;
    
    return this.sendSMS({
      to: phoneNumber,
      message,
      fromName: businessName
    });
  }

  /**
   * Get MCP tool definition for general SMS sending
   */
  static getToolDefinition(): MCPTool {
    return {
      name: 'SMS_SendMessage',
      description: 'Sends SMS text messages to customers (currently logs to console for development)',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Phone number to send SMS to (with country code, e.g., +1234567890)'
          },
          message: {
            type: 'string',
            description: 'Message content to send'
          },
          fromName: {
            type: 'string',
            description: 'Name to send from (default: Adventure Harmony)'
          }
        },
        required: ['to', 'message']
      }
    };
  }

  /**
   * Get MCP tool definition for sending form links specifically
   */
  static getFormLinkToolDefinition(): MCPTool {
    return {
      name: 'SMS_SendFormLink',
      description: 'Send form link via SMS to customers',
      inputSchema: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description: 'Phone number to send form link to (with country code, e.g., +1234567890)'
          },
          formUrl: {
            type: 'string',
            description: 'URL of the form to send to customer'
          },
          formTitle: {
            type: 'string',
            description: 'Title of the form for the SMS message'
          },
          businessName: {
            type: 'string',
            description: 'Name of the business sending the form',
            default: 'Adventure Harmony'
          }
        },
        required: ['phoneNumber', 'formUrl', 'formTitle']
      }
    };
  }
}