"""Tests for the documentation helper only; not tests of the three upstream apps."""
from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from audit_sources import audit_repo, write_new_report

class AuditHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        self.run_git('init', '-q')
        (self.repo/'package.json').write_text(json.dumps({'name':'fixture','scripts':{'test':'do-not-run'}}))
        (self.repo/'README.md').write_text('Fixture only.\n')
        self.commit()
        self.sha=self.run_git('rev-parse','HEAD').stdout.strip()
        self.spec={'repository':'test/fixture','commit':self.sha,'paths':['README.md','package.json']}
    def tearDown(self):self.temp.cleanup()
    def run_git(self,*args):
        return subprocess.run(['git','-C',str(self.repo),*args],text=True,capture_output=True,check=True)
    def commit(self):
        self.run_git('add','.')
        self.run_git('-c','user.name=Test Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture')
    def test_exact_pin(self):
        self.assertEqual(audit_repo(self.repo,self.spec)['status'],'PASS_SOURCE_AUDIT')
    def test_dirty_is_reported_and_preserved(self):
        p=self.repo/'README.md';p.write_text('User changes.\n')
        self.assertEqual(audit_repo(self.repo,self.spec)['status'],'FAIL')
        self.assertEqual(p.read_text(),'User changes.\n')
    def test_descendant_opt_in(self):
        (self.repo/'new.txt').write_text('new\n');self.commit()
        self.assertEqual(audit_repo(self.repo,self.spec)['status'],'FAIL')
        self.assertEqual(audit_repo(self.repo,self.spec,allow_descendant=True)['status'],'PASS_SOURCE_AUDIT')
    def test_missing_commit(self):
        self.spec['commit']='1'*40
        self.assertEqual(audit_repo(self.repo,self.spec)['status'],'FAIL')
    def test_missing_required_file(self):
        self.spec['paths'].append('missing.ts')
        self.assertEqual(audit_repo(self.repo,self.spec)['status'],'FAIL')
    def test_does_not_overwrite_report(self):
        p=Path(self.temp.name)/'out.json'
        write_new_report(p,{'first':True})
        with self.assertRaises(FileExistsError):write_new_report(p,{'second':True})
        self.assertEqual(json.loads(p.read_text()),{'first':True})

if __name__=='__main__':unittest.main()
