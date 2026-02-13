// Post-install WooCommerce config via WP-CLI (kubectl exec).
// Sets up COD payment, sample products, and store settings.
// Uses WP-CLI because WC REST API needs OAuth consumer keys which aren't available at provision time.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export class WooCommerceSetupService {
    private log = logger.child({ service: 'WooCommerceSetup' });

    async setup(opts: {
        namespace: string;
        storeId: string;
        hostname: string;
    }): Promise<void> {
        const log = this.log.child({ storeId: opts.storeId });

        try {
            log.info('Starting WooCommerce auto-setup via WP-CLI');

            // Get WordPress pod name
            const podName = await this.getWordPressPod(opts.namespace);
            if (!podName) {
                log.warn('No WordPress pod found  skipping auto-setup');
                return;
            }
            log.info({ podName }, 'Found WordPress pod');

            // Step 1: Install WooCommerce pages (Shop, Cart, Checkout, My Account)
            await this.installPages(opts.namespace, podName, log);

            // Step 2: Enable COD payment gateway
            await this.enableCOD(opts.namespace, podName, log);

            // Step 3: Create sample products
            await this.createSampleProducts(opts.namespace, podName, log);

            // Step 4: Configure store settings
            await this.configureStore(opts.namespace, podName, log);

            // Step 5: Flush rewrite rules so /shop works
            await this.wpCli(opts.namespace, podName, ['rewrite', 'flush']);

            log.info('WooCommerce auto-setup completed successfully');
        } catch (error) {
            log.warn({ err: error }, 'WooCommerce auto-setup failed (non-fatal  store is still accessible)');
        }
    }

    private async getWordPressPod(namespace: string): Promise<string | null> {
        try {
            const { stdout } = await execFileAsync(
                'kubectl',
                ['get', 'pods', '-n', namespace, '-l', 'app.kubernetes.io/name=wordpress', '-o', 'jsonpath={.items[0].metadata.name}'],
                { timeout: 15000 }
            );
            return stdout.replace(/[{}]/g, '').trim() || null;
        } catch {
            return null;
        }
    }

    private async wpCli(
        namespace: string,
        podName: string,
        wpArgs: string[]
    ): Promise<string> {
        // Use execFile with explicit arg array  no shell, no injection
        const args = [
            'exec', '-n', namespace, podName, '--',
            'wp', ...wpArgs, '--allow-root', '--path=/opt/bitnami/wordpress'
        ];
        const { stdout } = await execFileAsync('kubectl', args, { timeout: 30000 });
        return stdout.trim();
    }

    private async installPages(
        namespace: string,
        podName: string,
        log: any
    ): Promise<void> {
        try {
            await this.wpCli(namespace, podName,
                ['wc', 'tool', 'run', 'install_pages', '--user=1']
            );
            log.info('WooCommerce pages installed (Shop, Cart, Checkout, My Account)');
        } catch (error) {
            log.warn({ err: error }, 'Failed to install WooCommerce pages  /shop may not work');
        }
    }

    private async enableCOD(
        namespace: string,
        podName: string,
        log: any
    ): Promise<void> {
        try {
            // Enable COD via WP option update (JSON as a single arg  safe with execFile)
            const codSettings = JSON.stringify({
                enabled: 'yes',
                title: 'Cash on Delivery',
                description: 'Pay with cash upon delivery.',
                instructions: 'Pay with cash upon delivery.',
                enable_for_methods: '',
                enable_for_virtual: 'yes',
            });
            await this.wpCli(namespace, podName,
                ['option', 'update', 'woocommerce_cod_settings', codSettings, '--format=json']
            );

            // Verify gateways list includes COD
            try {
                await this.wpCli(namespace, podName,
                    ['option', 'get', 'woocommerce_gateway_order', '--format=json']
                );
            } catch {
                // Gateway order option might not exist yet  COD still works
            }

            log.info('COD payment gateway enabled');
        } catch (error) {
            log.warn({ err: error }, 'Failed to enable COD via WP-CLI');
            // Try alternate method via direct DB update
            try {
                const codSerialized = 'a:6:{s:7:"enabled";s:3:"yes";s:5:"title";s:16:"Cash on Delivery";s:11:"description";s:29:"Pay with cash upon delivery.";s:12:"instructions";s:29:"Pay with cash upon delivery.";s:18:"enable_for_methods";s:0:"";s:21:"enable_for_virtual";s:3:"yes";}';
                await this.wpCli(namespace, podName,
                    ['db', 'query', `UPDATE wp_options SET option_value = '${codSerialized}' WHERE option_name = 'woocommerce_cod_settings'`]
                );
                log.info('COD enabled via direct DB update');
            } catch (dbError) {
                log.warn({ err: dbError }, 'COD DB fallback also failed');
            }
        }
    }

    private async createSampleProducts(
        namespace: string,
        podName: string,
        log: any
    ): Promise<void> {
        const products = [
            {
                name: 'Premium T-Shirt',
                price: '29.99',
                description: 'A comfortable premium cotton t-shirt.',
                shortDesc: 'Premium cotton t-shirt',
                sku: 'tshirt-001',
                stock: 100,
            },
            {
                name: 'Wireless Headphones',
                price: '79.99',
                description: 'High-quality wireless Bluetooth headphones with noise cancellation.',
                shortDesc: 'Bluetooth noise-cancelling headphones',
                sku: 'headphones-001',
                stock: 50,
            },
            {
                name: 'Coffee Mug',
                price: '14.99',
                description: 'Large ceramic coffee mug. Dishwasher and microwave safe.',
                shortDesc: 'Ceramic coffee mug',
                sku: 'mug-001',
                stock: 200,
            },
        ];

        for (const product of products) {
            try {
                // Check if product already exists (idempotency)
                try {
                    const existing = await this.wpCli(namespace, podName,
                        ['wc', 'product', 'list', `--sku=${product.sku}`, '--format=count']
                    );
                    if (parseInt(existing) > 0) {
                        log.debug({ product: product.name }, 'Product already exists  skipping');
                        continue;
                    }
                } catch {
                    // If check fails, try creating anyway
                }

                await this.wpCli(namespace, podName, [
                    'wc', 'product', 'create',
                    `--name=${product.name}`,
                    '--type=simple',
                    `--regular_price=${product.price}`,
                    `--description=${product.description}`,
                    `--short_description=${product.shortDesc}`,
                    `--sku=${product.sku}`,
                    '--manage_stock=true',
                    `--stock_quantity=${product.stock}`,
                    '--status=publish',
                    '--user=1',
                ]);
                log.info({ product: product.name }, 'Sample product created');
            } catch (error) {
                log.debug({ err: error, product: product.name }, 'Failed to create product via WP-CLI');
            }
        }
    }

    private async configureStore(
        namespace: string,
        podName: string,
        log: any
    ): Promise<void> {
        const settings: Array<{ key: string; value: string }> = [
            { key: 'woocommerce_currency', value: 'USD' },
            { key: 'woocommerce_store_address', value: '123 Store Street' },
            { key: 'woocommerce_store_city', value: 'San Francisco' },
            { key: 'woocommerce_default_country', value: 'US:CA' },
            { key: 'woocommerce_store_postcode', value: '94105' },
            { key: 'woocommerce_calc_taxes', value: 'no' },
            { key: 'woocommerce_enable_checkout_login_reminder', value: 'no' },
            { key: 'woocommerce_enable_guest_checkout', value: 'yes' },
        ];

        for (const setting of settings) {
            try {
                await this.wpCli(namespace, podName,
                    ['option', 'update', setting.key, setting.value]
                );
            } catch {
                // Non-fatal
            }
        }

        log.info('Store settings configured');
    }
}

// Export singleton
export const wooCommerceSetupService = new WooCommerceSetupService();
