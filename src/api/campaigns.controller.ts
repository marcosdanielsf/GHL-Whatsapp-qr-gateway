import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Create a new campaign (Bulk Send)
router.post('/create', requireAuth, async (req: Request, res: Response) => {
    const { name, instanceId, message, numbers, mediaUrl, type } = req.body;
    const authReq = req as AuthenticatedRequest;
    const tenantId = authReq.user?.id;

    if (!instanceId || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({ error: 'Instance ID and a list of numbers are required' });
    }

    if (!message && !mediaUrl) {
        return res.status(400).json({ error: 'Message or Media URL is required' });
    }

    const supabase = getSupabaseClient();
    const batchSize = 100; // Insert in batches to avoid payload limits
    const totalNumbers = numbers.length;
    let processedCount = 0;
    let errorCount = 0;

    logger.info(`Starting campaign '${name}' for tenant ${tenantId} on instance ${instanceId} with ${totalNumbers} recipients.`);

    try {
        // We'll insert directly into the queue table
        // Ideally, we would have a 'campaigns' table and link these messages to it via a campaign_id
        // For now, we'll just push to the queue to get it working immediately as requested.

        // Clean numbers (remove non-digits, ensure format)
        // This is a basic cleanup.
        const cleanedNumbers = numbers.map((n: string) => n.replace(/\D/g, ''));

        // Prepare rows for insertion
        const rows = cleanedNumbers.map((num: string) => ({
            instance_id: instanceId,
            type: type || (mediaUrl ? 'image' : 'text'),
            to_number: num,
            content: mediaUrl || message,
            status: 'pending',
            created_at: new Date().toISOString(),
            // We might want to store metadata if the table supports it, but based on queue.ts it might not be flexible.
            // verifying queue.ts usage: const { id, instance_id, type, to_number, content, attempts, max_attempts } = job;
        }));

        // Batch insert
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const { error } = await supabase
                .from('ghl_wa_message_queue')
                .insert(batch);

            if (error) {
                logger.error('Error inserting batch into queue', { error, batchIndex: i });
                errorCount += batch.length;
            } else {
                processedCount += batch.length;
            }
        }

        logger.info(`Campaign '${name}' processed. ${processedCount} queued, ${errorCount} failed to queue.`);

        return res.status(200).json({
            success: true,
            message: `Campaign queued successfully. ${processedCount} messages added to queue.`,
            stats: {
                total: totalNumbers,
                queued: processedCount,
                failed: errorCount
            }
        });

    } catch (error: any) {
        logger.error('Error creating campaign', { error: error.message });
        return res.status(500).json({ error: 'Internal server error processing campaign' });
    }
});

// Get campaign history (Simulated by aggregating queue/history for now)
// Since we don't have a campaigns table yet, we can't really group them easily without a campaign_id in the queue.
// For MVP, we might just show recent queue items or build a simple 'recent activity' view.
// But the user wants a "Campaigns" view.
// Let's rely on the frontend to manage the "view" of success for now, or just show the queue status.

export const campaignsRouter = router;
