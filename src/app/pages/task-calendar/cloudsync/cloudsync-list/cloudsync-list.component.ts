import { WebSocketService, DialogService, JobService, EngineerModeService} from '../../../../services';
import { Component } from '@angular/core';
import { Router } from '@angular/router';

import * as _ from 'lodash';
import { T } from '../../../../translate-marker';
import { TranslateService } from '@ngx-translate/core';
import { EntityUtils } from '../../../common/entity/utils';
import { Moment } from 'moment';
import * as cronParser from 'cron-parser';

@Component({
  selector: 'app-cloudsync-list',
  template: `<entity-table [title]="title" [conf]="this"></entity-table>`,
  providers: [JobService],
})
export class CloudsyncListComponent {

  public title = "Cloud Sync Tasks";
  protected queryCall = 'cloudsync.query';
  protected route_add: string[] = ['tasks', 'cloudsync', 'add'];
  protected route_add_tooltip = "Add Cloud Sync Task";
  protected route_edit: string[] = ['tasks', 'cloudsync', 'edit'];
  protected wsDelete = "cloudsync.delete";
  protected entityList: any;
  protected asyncView = true;

  public columns: Array < any > = [
    { name: T('Description'), prop: 'description' },
    { name: T('Schedule'), prop: 'cron', hidden: true },
    { name: T('Next Run'), prop: 'next_run', hidden: true },
    { name: T('Credential'), prop: 'credential', hidden: true },
    { name: T('Direction'), prop: 'direction', hidden: true},
    { name: T('Path'), prop: 'path', hidden: true},
    { name: T('Minute'), prop: 'minute', hidden: true },
    { name: T('Hour'), prop: 'hour', hidden: true },
    { name: T('Day of Month'), prop: 'dom', hidden: true },
    { name: T('Month'), prop: 'month', hidden: true },
    { name: T('Day of Week'), prop: 'dow', hidden: true },
    { name: T('Status'), prop: 'status', state: 'state'},
    { name: T('Enabled'), prop: 'enabled' },
  ];
  public config: any = {
    paging: true,
    sorting: { columns: this.columns },
    deleteMsg: {
      title: 'Cloud Sync Task',
      key_props: ['description']
    },
  };

  public hasDetails = true;
  public detailsConf = {
    direction: 'horizontal',
    showAction: false,
  };
  public detailColumns: Array < any > = [
    { name: T('Direction'), prop: 'direction'},
    { name: T('Path'), prop: 'path'},
    { name: T('Schedule'), prop: 'cron' },
    { name: T('Next Run'), prop: 'next_run' },
    { name: T('Minute'), prop: 'minute' },
    { name: T('Hour'), prop: 'hour' },
    { name: T('Day of Month'), prop: 'dom' },
    { name: T('Month'), prop: 'month' },
    { name: T('Day of Week'), prop: 'dow' },
    { name: T('Auxiliary arguments'), prop: 'args', isHidden: true},
    { name: T('Credential'), prop: 'credentials.name' },
  ];

  constructor(protected router: Router,
              protected ws: WebSocketService,
              protected translateService: TranslateService,
              protected dialog: DialogService,
              protected job: JobService,
              protected engineerModeService: EngineerModeService) {
              }

  preInit(entityList) {
    if (localStorage.getItem('engineerMode') === 'true') {
      this.columns.splice(9, 0, { name: T('Auxiliary arguments'), prop: 'args' });
    }
    const argsColumn = _.find(this.detailColumns, {prop: 'args'});
    this.engineerModeService.engineerMode.subscribe((res) => {
      argsColumn.isHidden = res === 'true' ? false : true;
    });

  }

  afterInit(entityList: any) {
    this.entityList = entityList;
  }

  getActions(parentrow) {
    return [{
      id: "start",
      label: T("Run Now"),
      onClick: (row) => {
        this.dialog.confirm(T("Run Now"), T("Run this cloud sync now?"), true).subscribe((res) => {
          if (res) {
            row.state = 'RUNNING';
            this.ws.call('cloudsync.sync', [row.id]).subscribe(
              (res) => {
                this.translateService.get("close").subscribe((close) => {
                  this.entityList.snackBar.open(T('Cloud sync has started.'), close, { duration: 5000 });
                });
                this.job.getJobStatus(res).subscribe((task) => {
                  row.state = task.state;
                  row.job = task;
                  row.status = task.state;
                  if (task.error) {
                    row.status += ":" + task.error;
                  }
                  if (task.progress.description && task.state != 'SUCCESS') {
                    row.status += ':' + task.progress.description;
                  }
                });
              },
              (err) => {
                new EntityUtils().handleWSError(this.entityList, err);
              })
          }
        });
      },
    }, {
      id: "stop",
      label: T("Stop"),
      onClick: (row) => {
        this.dialog.confirm(T("Stop"), T("Stop this cloud sync?"), true).subscribe((res) => {
          if (res) {
            this.ws.call('cloudsync.abort', [row.id]).subscribe(
              (wsRes) => {
                this.translateService.get("close").subscribe((close) => {
                  this.entityList.snackBar.open(T('Cloud sync stopped.'), close, { duration: 5000 });
                });
              },
              (wsErr) => {
                new EntityUtils().handleWSError(this.entityList, wsErr);
              })
          }
        });
      },
    }, {
      id: "edit",
      label: T("Edit"),
      onClick: (row) => {
        this.route_edit.push(row.id);
        this.router.navigate(this.route_edit);
      },
    }, {
      id: "delete",
      label: T("Delete"),
      onClick: (row) => {
        this.entityList.doDelete(row);
      },
    }]
  }

  isActionVisible(actionId: string, row: any) {
    if (actionId === 'start' && row.job && row.job.state === 'RUNNING') {
      return false;
    } else if (actionId === 'stop' && row.job && row.job.state !== 'RUNNING') {
      return false;
    }
    return true;
  }

  dataHandler(entityList: any) {
    for (let i = 0; i < entityList.rows.length; i++) {
      const task = entityList.rows[i];

      task.minute = task.schedule['minute'];
      task.hour = task.schedule['hour'];
      task.dom = task.schedule['dom'];
      task.month = task.schedule['month'];
      task.dow = task.schedule['dow'];
      task.credential = task.credentials['name'];

      task.cron = `${task.minute} ${task.hour} ${task.dom} ${task.month} ${task.dow}`;

      /* Weird type assertions are due to a type definition error in the cron-parser library */
      task.next_run = ((cronParser.parseExpression(task.cron, { iterator: true }).next() as unknown) as {
        value: { _date: Moment };
      }).value._date.fromNow();

      if (task.job == null) {
        task.status = T("Not run since last boot");
      } else {
        task.state = task.job.state;
        task.status = task.job.state;
        if (task.job.error) {
          task.status += ":" + task.job.error;
        }
        this.job.getJobStatus(task.job.id).subscribe((t) => {
          task.state = task.job.state;
          task.status = t.state;
          if (t.error) {
            task.status += ":" + t.error;
          }
          if (t.progress.description && t.state !== 'SUCCESS') {
            task.status += ':' + t.progress.description;
          }
        });
      }
      console.log({task});
    }
  }

  stateButton(row) {
    this.job.showLogs(row.job.id);
  }
}