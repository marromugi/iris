import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_agents.sql';
import m0002 from './0002_run_due_at.sql';
import m0003 from './0003_threads.sql';
import m0004 from './0004_groups.sql';
import m0005 from './0005_agent_looks.sql';
import m0006 from './0006_consults.sql';
import m0007 from './0007_consult_indexes.sql';
import m0008 from './0008_search_counts.sql';
import m0009 from './0009_agent_deactivated.sql';
import m0010 from './0010_daily_summaries.sql';
import m0011 from './0011_mails.sql';
import m0012 from './0012_mail_setup.sql';
import m0013 from './0013_mail_confirmation_account.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009,
m0010,
m0011,
m0012,
m0013
    }
  }
  