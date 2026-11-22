import logo from '../assets/comforce-logo.jpg'

export function Logo() {
  return <a href="#home" className="brand" aria-label="Milwaukee Together home">
    <img className="brand-logo" src={logo} width={374} height={368} alt="" />
    <strong>Milwaukee Together</strong>
  </a>
}
