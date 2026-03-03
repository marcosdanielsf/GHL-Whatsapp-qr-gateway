import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';

export const useSupabaseAuthState = async (instanceId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    const supabase = getSupabaseClient();
    const TABLE_NAME = 'ghl_wa_sessions';

    // Helper to read data
    const readData = async (key: string) => {
        try {
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .select('value')
                .eq('instance_id', instanceId)
                .eq('key', key)
                .single();

            if (error || !data) return null;
            return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
        } catch (error) {
            return null;
        }
    };

    // Helper to write data
    const writeData = async (key: string, value: any) => {
        try {
            const { error } = await supabase
                .from(TABLE_NAME)
                .upsert({
                    instance_id: instanceId,
                    key: key,
                    value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'instance_id,key' });

            if (error) {
                logger.error(`Error writing session data for ${instanceId}/${key}:`, error);
            }
        } catch (error) {
            logger.error(`Error writing session data for ${instanceId}/${key}:`, error);
        }
    };

    // Helper to remove data
    const removeData = async (key: string) => {
        try {
            await supabase
                .from(TABLE_NAME)
                .delete()
                .eq('instance_id', instanceId)
                .eq('key', key);
        } catch (error) {
            logger.error(`Error deleting session data for ${instanceId}/${key}:`, error);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [id: string]: any } = {};
                    if (ids.length === 0) return data;
                    try {
                        const keys = ids.map(id => `${type}-${id}`);
                        const { data: rows, error } = await supabase
                            .from(TABLE_NAME)
                            .select('key, value')
                            .eq('instance_id', instanceId)
                            .in('key', keys);
                        if (error || !rows) return data;
                        for (const row of rows) {
                            const id = row.key.slice(`${type}-`.length);
                            let value = JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            if (value) {
                                data[id] = value;
                            }
                        }
                    } catch (err) {
                        logger.error(`Error batch-fetching session keys for ${instanceId}/${type}:`, err);
                    }
                    return data;
                },
                set: async (
                    data: { [C in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[C] } }
                ) => {
                    const tasks: Promise<void>[] = [];
                    for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
                        const categoryData = data[category];
                        if (!categoryData) continue;
                        for (const id of Object.keys(categoryData)) {
                            const value = categoryData[id];
                            const key = `${String(category)}-${id}`;
                            if (value) {
                                tasks.push(writeData(key, value));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        }
    };
};

import { proto } from '@whiskeysockets/baileys';
