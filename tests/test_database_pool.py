import threading
import time
import unittest

import database
from database import DatabasePool, close_db


class _FakeRawConnection:
    def __init__(self):
        self.cursor_factory = None
        self.commit_calls = 0
        self.rollback_calls = 0

    def commit(self):
        self.commit_calls += 1

    def rollback(self):
        self.rollback_calls += 1


class _FakePool:
    def __init__(self):
        self.getconn_calls = 0
        self.putconn_calls = 0
        self._lock = threading.Lock()

    def getconn(self):
        with self._lock:
            self.getconn_calls += 1
        return _FakeRawConnection()

    def putconn(self, conn):
        with self._lock:
            self.putconn_calls += 1


class DatabasePoolTests(unittest.TestCase):
    def setUp(self):
        self.original_type = database.DB_CONFIG.get('TYPE')
        self.original_pg = dict(database.DB_CONFIG.get('POSTGRES', {}))
        database.DB_CONFIG['TYPE'] = 'postgres'
        database.DB_CONFIG['POSTGRES']['POOL_ACQUIRE_TIMEOUT'] = 0.5
        DatabasePool._pg_pool = None
        DatabasePool._pg_pool_semaphore = None
        DatabasePool._pg_pool_timeout_seconds = 0.5
        DatabasePool._local = threading.local()

    def tearDown(self):
        try:
            close_db()
        except Exception:
            pass
        database.DB_CONFIG['TYPE'] = self.original_type
        database.DB_CONFIG['POSTGRES'].clear()
        database.DB_CONFIG['POSTGRES'].update(self.original_pg)
        DatabasePool._pg_pool = None
        DatabasePool._pg_pool_semaphore = None
        DatabasePool._pg_pool_timeout_seconds = 15.0
        DatabasePool._local = threading.local()

    def test_reentrant_postgres_context_reuses_same_checkout(self):
        fake_pool = _FakePool()
        DatabasePool._pg_pool = fake_pool
        DatabasePool._pg_pool_semaphore = threading.BoundedSemaphore(2)

        with DatabasePool.get_connection() as outer:
            with DatabasePool.get_connection() as inner:
                self.assertIs(outer, inner)
                self.assertEqual(fake_pool.getconn_calls, 1)

        self.assertEqual(fake_pool.putconn_calls, 1)

    def test_pool_waits_for_available_connection(self):
        fake_pool = _FakePool()
        DatabasePool._pg_pool = fake_pool
        DatabasePool._pg_pool_semaphore = threading.BoundedSemaphore(1)
        DatabasePool._pg_pool_timeout_seconds = 0.5

        ready = threading.Event()
        release = threading.Event()
        timings = {}
        errors = []

        def holder():
            try:
                with DatabasePool.get_connection():
                    ready.set()
                    release.wait(timeout=1)
            except Exception as exc:
                errors.append(exc)

        def waiter():
            try:
                ready.wait(timeout=1)
                start = time.perf_counter()
                with DatabasePool.get_connection():
                    timings['elapsed'] = time.perf_counter() - start
            except Exception as exc:
                errors.append(exc)

        t1 = threading.Thread(target=holder)
        t2 = threading.Thread(target=waiter)
        t1.start()
        t2.start()

        ready.wait(timeout=1)
        time.sleep(0.15)
        release.set()

        t1.join(timeout=1)
        t2.join(timeout=1)

        self.assertFalse(errors, f"Unexpected errors: {errors}")
        self.assertGreaterEqual(timings.get('elapsed', 0), 0.12)
        self.assertEqual(fake_pool.getconn_calls, 2)
        self.assertEqual(fake_pool.putconn_calls, 2)


if __name__ == '__main__':
    unittest.main()
