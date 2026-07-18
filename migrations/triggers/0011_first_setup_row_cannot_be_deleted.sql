CREATE TRIGGER IF NOT EXISTS "first_setup_row_cannot_be_deleted" BEFORE DELETE ON "first_setup" BEGIN SELECT RAISE(ABORT, 'first_setup_row_cannot_be_deleted'); END;
