"""Real HTTP integration tests for the transport; no simulated video or GPU claims."""
import http.client
import json
from pathlib import Path
import queue
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control import CommandError, ControlBridge, ControlServer, validate_command

TOKEN = 'unit-test-control-token-not-a-secret'
ORIGIN = 'http://localhost:3000'


class ValidationTests(unittest.TestCase):
    def test_invalid_commands_cannot_reach_the_simulator(self):
        for body in [None, [], {}, {'action': []}, {'action': 'execute_python'},
                     {'action': 'set_demo', 'enabled': 1}, {'action': 'set_camera', 'camera': '../other'},
                     {'action': 'play', 'extra': True}, {'action': 'set_camera'}]:
            with self.subTest(body=body), self.assertRaises(CommandError):
                validate_command(body)

    def test_queue_is_bounded(self):
        bridge = ControlBridge(capacity=1)
        bridge.enqueue({'action': 'play'})
        with self.assertRaises(queue.Full):
            bridge.enqueue({'action': 'reset'})

    def test_expired_commands_never_execute_later(self):
        bridge = ControlBridge()
        ticket = bridge.enqueue({'action': 'play'}, timeout=-1)
        calls = []
        bridge.drain(lambda command: calls.append(command))
        self.assertEqual(calls, [])
        self.assertEqual(ticket.status, 504)
        self.assertTrue(ticket.done.is_set())

    def test_snapshots_are_isolated(self):
        bridge = ControlBridge()
        original = {'ready': True, 'joints': [0.1]}
        bridge.publish(original)
        original['joints'][0] = 99
        snapshot = bridge.snapshot()
        snapshot['joints'][0] = 88
        self.assertEqual(bridge.snapshot()['joints'], [0.1])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.bridge = ControlBridge()
        self.bridge.publish({'ready': True, 'running': False})
        self.server = ControlServer(self.bridge, '127.0.0.1', 0, TOKEN, [ORIGIN], command_timeout=0.15)
        self.server.start()
        self.addCleanup(self.server.close)

    def request(self, method, path, body=None, token=TOKEN, origin=ORIGIN, content_type='application/json'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.http.server_port, timeout=2)
        headers = {'Content-Type': content_type}
        if token is not None:
            headers['Authorization'] = f'Bearer {token}'
        if origin is not None:
            headers['Origin'] = origin
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        conn.close()
        return result

    def test_auth_and_origin_checks(self):
        self.assertEqual(self.request('GET', '/state', token='wrong')[0], 401)
        self.assertEqual(self.request('GET', '/state', token=None)[0], 401)
        self.assertEqual(self.request('GET', '/state', origin='https://untrusted.example')[0], 403)
        status, headers, body = self.request('GET', '/state')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)
        self.assertTrue(body['ready'])
        self.assertEqual(self.request('GET', '/state', origin=None)[0], 200)

    def test_preflight_does_not_require_a_token(self):
        status, headers, _ = self.request('OPTIONS', '/command', token=None)
        self.assertEqual(status, 200)
        self.assertIn('Authorization', headers['Access-Control-Allow-Headers'])
        self.assertEqual(self.request('OPTIONS', '/command', origin='null')[0], 403)

    def test_loading_is_not_reported_as_ready(self):
        self.bridge.publish({'ready': False})
        self.assertEqual(self.request('GET', '/state')[0], 503)
        self.assertEqual(self.request('POST', '/command', {'action': 'play'})[0], 503)

    def test_command_ack_waits_for_main_thread_execution(self):
        result = []
        thread = threading.Thread(target=lambda: result.append(self.request('POST', '/command', {'action': 'play'})))
        thread.start()
        deadline = time.monotonic() + 1
        while self.bridge.commands.empty() and time.monotonic() < deadline:
            time.sleep(0.002)
        self.assertFalse(self.bridge.commands.empty())
        self.assertTrue(thread.is_alive())
        execute_thread = []
        def execute(command):
            execute_thread.append(threading.get_ident())
            self.bridge.publish({'ready': True, 'running': command['action'] == 'play'})
            return self.bridge.snapshot()
        self.bridge.drain(execute)
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result[0][0], 200)
        self.assertTrue(result[0][2]['state']['running'])
        self.assertEqual(execute_thread, [threading.get_ident()])

    def test_timeout_does_not_apply_a_queued_command(self):
        status, _, result = self.request('POST', '/command', {'action': 'reset'})
        self.assertEqual(status, 504)
        self.assertIn('acknowledge', result['error'])
        executed = []
        self.bridge.drain(lambda command: executed.append(command))
        self.assertEqual(executed, [])

    def test_invalid_payloads_are_rejected(self):
        self.assertEqual(self.request('POST', '/command', {'action': 'delete_stage'})[0], 400)
        self.assertEqual(self.request('POST', '/command', {'action': 'play'}, content_type='text/plain')[0], 415)
        self.assertEqual(self.request('POST', '/command', {'action': 'x' * 5000})[0], 413)
        self.assertEqual(self.request('GET', '/missing')[0], 404)

    def test_simulator_errors_are_returned_and_queue_recovers(self):
        ticket = self.bridge.enqueue({'action': 'reset'})
        def fail(_):
            raise RuntimeError('physics unavailable')
        self.bridge.drain(fail)
        self.assertEqual(ticket.status, 500)
        self.assertIn('physics unavailable', ticket.error)
        next_ticket = self.bridge.enqueue({'action': 'pause'})
        self.bridge.drain(lambda _: {'ready': True, 'running': False})
        self.assertTrue(next_ticket.done.is_set())
        self.assertIsNone(next_ticket.error)


if __name__ == '__main__':
    unittest.main()
