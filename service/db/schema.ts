import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const submissions = sqliteTable('submissions', {
  receipt: text('receipt').primaryKey(),
  reportId: text('report_id').notNull().unique(),
  digest: text('digest').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  reviewedAt: integer('reviewed_at'),
}, table => [index('submissions_status_created').on(table.status, table.createdAt)]);
export const rateLimits = sqliteTable('rate_limits', {
  bucket: text('bucket').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
