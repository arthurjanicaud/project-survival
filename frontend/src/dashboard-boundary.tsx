import {Component,type ReactNode} from 'react';
export class DashboardBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main role="alert" style={{minHeight:'100vh',background:'#0b100e',color:'#edf0e8',padding:'48px 24px',fontFamily:'system-ui'}}><h1>Le tableau de bord ne peut pas s’afficher.</h1><p>Une erreur d’affichage est survenue. Le moteur fonctionne indépendamment de cette page.</p><button onClick={()=>location.reload()} style={{padding:'12px 20px',cursor:'pointer'}}>Recharger le tableau de bord</button><p>Si le problème persiste, signale cette erreur pour vérification.</p></main>:this.props.children;}
}
